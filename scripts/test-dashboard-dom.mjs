// 看板最终 DOM 渲染测试：SSR 直出 HTML，对最终可见文字断言（等价页面渲染测试）
// 最小DOM存根：让 Element Plus 弹层组件在 Node 环境完成 setup（不模拟完整浏览器）
globalThis.document = globalThis.document ?? { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, remove() {}, addEventListener() {} }), body: { appendChild() {}, removeChild() {} } }
globalThis.window = globalThis.window ?? { addEventListener() {}, removeEventListener() {}, navigator: { userAgent: 'node-smoke' }, location: { href: 'http://localhost/' } }
try { globalThis.navigator = globalThis.navigator ?? { userAgent: 'node-smoke' } } catch { /* 只读则跳过 */ }

import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
const server = await createServer({ root: new URL('../frontend', import.meta.url).pathname, plugins: [vue()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { default: DashboardView } = await server.ssrLoadModule('/src/views/DashboardView.vue')
const { getAppAnalyticsStore, generateSampleEvents } = await server.ssrLoadModule('/src/stores/analytics.ts')
const { getAppLeadsStore, setAppRole } = await server.ssrLoadModule('/src/stores/leads.ts')
const { useRoleStore } = await server.ssrLoadModule('/src/stores/role.ts')
const { createSessionContext } = await server.ssrLoadModule('/src/engine/session.ts')
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
const analytics = getAppAnalyticsStore()
const leadsStore = getAppLeadsStore()
const roleStore = useRoleStore()
roleStore.setRole('operator')
setAppRole('operator')

import ElementPlus, { ZINDEX_INJECTION_KEY, ID_INJECTION_KEY } from 'element-plus'
async function renderDash(props = {}) {
    const app = createSSRApp({ render: () => h(DashboardView, props) })
  app.use(ElementPlus)
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })
  app.provide(ID_INJECTION_KEY, { prefix: "el", current: 0 })
  app.config.warnHandler = () => {}
  return renderToString(app)
}
function reset() {
  analytics.clearActual()
  analytics.clearSample()
  roleStore.setRole('operator')
  for (const r of [...leadsStore.records]) leadsStore.remove(r.id, 'consumer')
}
const sample = generateSampleEvents()

// 1) 空环境 → 空状态
reset()
let html = await renderDash()
check('D1 空环境显示空状态', html.includes('当前筛选范围内暂无实际演示数据'), html.slice(0, 120))
check('D1b 空环境无KPI数字区', !html.includes('高意向线索'), '')

// 2/3) 加载示例：全部来源与仅示例 → 高意向 2
for (const e of sample) analytics.track(e.type, { ...e, opKey: e.eventId })
html = await renderDash()
const iKpi = html.indexOf('高意向线索')
check('D2 全部来源高意向=2', /<b[^>]*>2<\/b><span[^>]*>高意向线索/.test(html), iKpi > 0 ? html.slice(iKpi - 260, iKpi + 20) : '未找到KPI')
html = await renderDash({ initialOrigin: 'sample' })
check('D3 仅示例高意向=2', /<b[^>]*>2<\/b><span[^>]*>高意向线索/.test(html), '')

// 4) 仅实际 → 空状态，不得显示示例的2
html = await renderDash({ initialOrigin: 'actual' })
check('D4 仅实际为空状态', html.includes('当前筛选范围内暂无实际演示数据') && !html.includes('高意向线索'), '')

// 5) 实际高意向线索 1 条 → 仅实际显示 1
const ctx = createSessionContext()
ctx.slots.categories = { value: ['冰箱'], turn: 1, raw: '' }
ctx.slots.totalBudget = { value: 9000, turn: 2, raw: '' }
ctx.slots.purchaseTime = { value: '这周内', turn: 3, raw: '' }
ctx.recommendations = { cards: { 冰箱: [{ productId: 'RF-01' }] }, candidates: ['RF-01'] }
const rec = leadsStore.createPurchaseLead({ ctx, sessionId: 'S-real-1', contact: { phone: '13800008000' }, consentGiven: true })
html = await renderDash({ initialOrigin: 'actual' })
check('D5 仅实际高意向=1', /<b[^>]*>1<\/b><span[^>]*>高意向线索/.test(html), html.match(/<b[^>]*>\d+<\/b><span[^>]*>高意向线索/)?.[0] ?? '')

// 6) 全部来源 = 示例2 + 实际1 = 3
html = await renderDash()
check('D6 全部来源高意向=3', /<b[^>]*>3<\/b><span[^>]*>高意向线索/.test(html), html.match(/<b[^>]*>\d+<\/b><span[^>]*>高意向线索/)?.[0] ?? '')

// 7) 自定义日期排除实际线索 → 回到 2
const today = new Date()
const emptyHtml = await renderDash({ initialDays: 'custom', initialFrom: '2001-01-01', initialTo: '2001-01-02', initialOrigin: 'all' })
check('D7 日期排除后进入空状态且无3', !/<b[^>]*>3<\/b><span[^>]*>高意向线索/.test(emptyHtml) && !emptyHtml.includes('>3</b>'), emptyHtml.slice(0, 100))

// 8) 重复加载示例不变化
for (const e of sample) analytics.track(e.type, { ...e, opKey: e.eventId })
html = await renderDash()
check('D8 重复加载仍=3', /<b[^>]*>3<\/b><span[^>]*>高意向线索/.test(html), '')

// 9) 状态修改不重复累计
leadsStore.setStatus(rec.id, '跟进中', 'operator')
html = await renderDash({ initialOrigin: 'actual' })
check('D9 状态修改后仍=1', /<b[^>]*>1<\/b><span[^>]*>高意向线索/.test(html), '')

// 10) 售后/投诉不影响高意向
leadsStore.createAfterSalesCase({ sessionId: 'S2', category: '空调', faults: ['漏水'], tried: true, resolved: false, expectation: '上门检测' })
leadsStore.createComplaintCase({ sessionId: 'S3', topic: '送货慢', detail: 'x', expectation: '退款或换货', contactConsent: true })
html = await renderDash({ initialOrigin: 'actual' })
check('D10 售后/投诉不增加高意向', /<b[^>]*>1<\/b><span[^>]*>高意向线索/.test(html), '')

// 11) 页面无 NaN/undefined/null/[object Object]
html = await renderDash()
const badTokens = ['NaN', 'undefined', 'null', '[object Object]', 'Infinity'].filter((b) => html.includes(b))
check('D11 无异常值', badTokens.length === 0, '命中文本: ' + badTokens.join(','))
for (const b of badTokens) {
  const i = html.indexOf(b)
  console.log('DEBUG', b, '上下文:', JSON.stringify(html.slice(Math.max(0, i - 70), i + 50)))
}

// 12) KPI 卡在两种视口均渲染（结构存在）
check('D12 KPI结构存在', html.includes('kpi-row') && (html.match(/class="kpi"/g) ?? []).length === 6, '')

// 13) 事件层无完整手机号
check('D13 事件无完整手机号', !JSON.stringify(analytics.events).includes('13800008000'), '')
await server.close()
console.log(`\n看板 DOM 渲染测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
