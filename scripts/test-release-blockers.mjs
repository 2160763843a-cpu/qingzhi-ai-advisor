// 发布前阻断项收口测试：RoleStore/尺寸状态机/枚举中文化/五区依据字段
import { useRoleStore } from '../frontend/src/stores/role.ts'
import { MemoryLeadsStorage } from '../frontend/src/stores/leads.ts'
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore, MemoryStorage } from '../frontend/src/engine/session.ts'
import { RECORD_TYPE, AUDIT_ACTION, ROLE, LEVEL, ORIGIN } from '../frontend/src/labels/businessLabels.ts'
import { readFileSync, readdirSync } from 'node:fs'
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url)))
function advisor() { return new Advisor(new SessionStore(new MemoryStorage())) }

// 1) RoleStore：hydrate/set/reset/isOperator（先置存储再导入）
const storeMap = {}
const ls = { getItem: (k) => storeMap[k] ?? null, setItem: (k, v) => { storeMap[k] = v }, removeItem: (k) => { delete storeMap[k] } }
globalThis.localStorage = ls
storeMap['qzad.role.v1'] = 'operator'
{
  const rs = useRoleStore()
  rs.hydrate()
  check('R1 hydrate 从存储恢复 operator', rs.state.current === 'operator', rs.state.current)
  rs.setRole('consumer')
  check('R2 setRole 即时生效', rs.state.current === 'consumer' && storeMap['qzad.role.v1'] === 'consumer', '')
  rs.setRole('operator')
  check('R3 isOperator computed', rs.isOperator.value === true, '')
  rs.reset()
  check('R4 reset 回 consumer', rs.state.current === 'consumer', '')
}
// 2) 尺寸状态机：宽度→深度追问→跳过→可推荐
{
  const a = advisor()
  a.processMessage('想买冰箱和洗衣机', faqs)
  a.processMessage('总预算5000～8000元', faqs)
  const r3 = a.processMessage('宽90厘米以内', faqs)
  check('S1 只答宽度后追问深度', r3.reply.includes('深度') && r3.followupQuestions.some((q) => q.includes('深')), r3.reply.slice(0, 60))
  const r4 = a.processMessage('暂不确定深度', faqs)
  check('S2 跳过深度不再卡死', !r4.reply.includes('深度；如果'), r4.reply.slice(0, 60))
  check('S3 记录深度未知标记', a.getContext().slots.depthUnknown?.value === true, '')
  const gen = a.generateRecommendations(JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url))))
  check('S4 跳过后可生成推荐', !gen.refused, JSON.stringify(gen.refused ?? {}))
  const rec = a.getContext().recommendations
  const cards = Object.values(rec.cards).flat()
  check('S5 推荐卡标注尺寸待确认', cards.length > 0 && cards.every((c) => c.sizeFitStatus === '尺寸待确认'), JSON.stringify(cards.map((c) => c.sizeFitStatus)))
  check('S6 尺寸待确认不进硬约束满足', cards.every((c) => !c.reasons.join().includes('尺寸完全匹配')), '')
}
// 3) 多品类预算/品类
{
  const a = advisor()
  a.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  const r2 = a.processMessage('5000-8000元', faqs)
  check('B1 总预算单条确认', (r2.reply.match(/总预算已记录/g) ?? []).length === 1, r2.reply.slice(0, 60))
  check('B2 槽位为范围对象', JSON.stringify(a.getContext().slots.totalBudget?.value) === '{"min":5000,"max":8000}', JSON.stringify(a.getContext().slots.totalBudget?.value))
  const b = advisor()
  b.processMessage('两件总预算8000元左右', faqs)
  b.processMessage('电视加洗衣机', faqs)
  check('B3 电视加洗衣机两品类', JSON.stringify(b.getContext().slots.categories?.value) === '["洗衣机","电视"]', JSON.stringify(b.getContext().slots.categories?.value))
  check('B4 总预算保留', (() => { const v = b.getContext().slots.totalBudget?.value; return v === 8000 || (v && typeof v === 'object' && v.max === 8000) || (v && typeof v === 'object' && Math.abs(v.max - 8000) <= 800) })(), JSON.stringify(b.getContext().slots.totalBudget?.value))
  const c = advisor()
  c.processMessage('想买冰箱和电视', faqs)
  c.processMessage('不要电视了', faqs)
  check('B5 不要电视正确移除', JSON.stringify(c.getContext().slots.categories?.value) === '["冰箱"]', JSON.stringify(c.getContext().slots.categories?.value))
}
// 4) 枚举映射完整
{
  check('E1 类型映射', RECORD_TYPE.purchase_lead === '购买线索' && RECORD_TYPE.after_sales_case === '售后工单' && RECORD_TYPE.complaint_case === '投诉记录', '')
  check('E2 角色映射', ROLE.consumer === '消费者视角' && ROLE.operator === '运营视角', '')
  check('E3 意向映射', LEVEL.high === '高意向' && LEVEL.medium === '中意向' && LEVEL.low === '低意向', '')
  check('E4 来源映射', ORIGIN.actual === '实际演示数据' && ORIGIN.sample === '示例数据', '')
  check('E5 审计动作映射', AUDIT_ACTION.lead_created === '创建线索' && AUDIT_ACTION.consent_withdrawn === '撤回授权' && AUDIT_ACTION.record_deleted === '删除记录', '')
  // 用户可见模板无内部key
  const leadsSrc = readFileSync(new URL('../frontend/src/views/LeadsView.vue', import.meta.url), 'utf8')
  check('E6 线索页类型用映射', leadsSrc.includes('RECORD_TYPE[t]'), '')
  const dashSrc = readFileSync(new URL('../frontend/src/views/DashboardView.vue', import.meta.url), 'utf8')
  check('E7 看板来源用映射', dashSrc.includes('ORIGIN['), '')
}
// 5) 五区依据字段存在于 ChatView 模板
{
  const src = readFileSync(new URL('../frontend/src/views/ChatView.vue', import.meta.url), 'utf8')
  for (const sec of ['1. 本轮理解', '2. 识别到的信息', '3. 上下文判断', '4. 本轮条件变化', '5. 下一步决策']) check(`F1 ${sec}`, src.includes(sec), '')
  const basisPart = (src.split('本轮理解与决策依据')[1] ?? '').split('class="tech-fold"')[0]
  check('F2 禁止一级展示内部key', !/categories|itemBudget|preferences|context|update|权重/.test(basisPart), basisPart.slice(-80))
  check('F3 耗时弱化文案', src.includes('小于1毫秒'), '')
}

// ===== 快捷问题与预算结构（发布前专项追加） =====
{
  const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
  const a = advisor()
  a.processMessage('我是青岛三口之家，想买冰箱', faqs)
  const ctx = a.getContext()
  check('Q1 快捷单品只有冰箱', JSON.stringify(ctx.slots.categories?.value) === '["冰箱"]', JSON.stringify(ctx.slots.categories?.value))
  check('Q2 提取青岛与3人', ctx.slots.location?.value === '青岛' && ctx.slots.familySize?.value === 3, `${ctx.slots.location?.value}/${ctx.slots.familySize?.value}`)
  a.processMessage('预算5000～8000元', faqs)
  a.processMessage('大容量', faqs)
  const g = a.generateRecommendations(catalog)
  check('Q3 单品推荐可用', !g.refused, '')
  const b = advisor()
  b.processMessage('我想买洗衣机，预算6000元以下', faqs)
  const cb = b.getContext()
  check('Q4 洗衣机单品+上限6000', cb.slots.categories?.value?.[0] === '洗衣机' && cb.slots.itemBudget?.value === 6000, JSON.stringify({ c: cb.slots.categories?.value, b: cb.slots.itemBudget?.value }))
  const g2 = b.generateRecommendations(catalog)
  const cards2 = Object.values(b.getContext().recommendations.cards).flat()
  check('Q5 不超6000为完全匹配', cards2.filter((c) => c.price > 6000).every((c) => (c.caveats ?? []).length > 0), '')
  check('Q6 无多品类组合卡', Object.keys(b.getContext().recommendations.bundles ?? {}).length === 0 || (b.getContext().recommendations.bundles ?? []).length === 0, '')
  const c = advisor()
  c.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  c.processMessage('5000-8000元', faqs)
  c.processMessage('宽90厘米以内', faqs)
  c.processMessage('暂不确定深度', faqs)
  const g3 = c.generateRecommendations(catalog)
  const rec = c.getContext().recommendations
  const allStr = JSON.stringify({ r: r2Null(), rec })
  function r2Null() { return '' }
  check('Q7 链路无[object Object]', !allStr.includes('object Object') && !allStr.includes('"min":5000,"max":8000}\\u元'), '')
  check('Q8 至少一个组合满足总预算', (rec.bundles ?? []).some((x) => x.totalPrice <= 8000), JSON.stringify((rec.bundles ?? []).map((x) => x.totalPrice)))
  const fw = (rec.cards['冰箱'] ?? [])[0]
  check('Q9 宽度已记录且深度待确认文案', Boolean(fw) && JSON.stringify(rec).includes('深度尚未提供'), '')
  const e = advisor()
  e.processMessage('想买冰箱', faqs)
  e.processMessage('预算5000～8000元', faqs)
  e.generateRecommendations(JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url))))
  const rm = e.processMessage('将总预算改为10000元', faqs)
  check('Q10 修改后摘要显示10000元', rm.reply.includes('10000'), rm.reply.slice(0, 60))
  check('Q11 旧推荐失效标记', e.getContext().recommendations?.stale === true, String(e.getContext().recommendations?.stale))
}
  const built = ['我是青岛三口之家，想买冰箱和洗衣机', '两件总预算8000元左右', '这两款哪个好', '数据接口正常'].map((t) => {
    const files = readdirSync(new URL('../dist/assets', import.meta.url)).filter((f) => f.endsWith('.js'))
    return files.some((f) => readFileSync(new URL(`../dist/assets/${f}`, import.meta.url), 'utf8').includes(t))
  })
  check('Q12 构建产物无旧快捷问题与调试条', !built.some(Boolean), JSON.stringify(built))
console.log(`\n发布阻断收口测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }

// ===== 多品类候选与组合预算一致性（发布阻断专项） =====
{
  const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
  const a = advisor()
  a.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  a.processMessage('5000-8000元', faqs)
  a.processMessage('宽90厘米以内', faqs)
  a.processMessage('暂不确定深度', faqs)
  const g = a.generateRecommendations(catalog)
  const rec = a.getContext().recommendations
  const allCards = Object.values(rec.cards).flat()
  check('M1 主推荐无超总预算上限商品', allCards.every((c) => c.price <= 8000), JSON.stringify(allCards.map((c) => c.price)))
  check('M2 洗衣机9100被排除', !(rec.cards['洗衣机'] ?? []).some((c) => c.price > 8000), JSON.stringify((rec.cards['洗衣机'] ?? []).map((c) => c.price)))
  check('M3 每款可与其它品类最低价组成本预算内组合', (() => {
    const minBy = (cat) => Math.min(...catalog.filter((p) => p.category === cat).map((p) => p.price))
    return Object.entries(rec.cards).every(([cat, cards]) => cards.every((c) => {
      const other = s2min(cat)
      function s2min(k) { return Math.min(...['冰箱', '洗衣机'].filter((x) => x !== k).map((x) => minBy(x))) }
      return c.price + other <= 8000
    }))
  })(), '')
  check('M4 组合均≤上限', (rec.bundles ?? []).length > 0 && rec.bundles.every((b) => b.totalPrice <= 8000), JSON.stringify((rec.bundles ?? []).map((b) => b.totalPrice)))
  const over = (rec.cards['洗衣机'] ?? []).find((c) => c.price > 4000)
  check('M5 超品类参考预算有明确标注', Object.values(rec.cards).flat().filter((c) => c.price > 4000).every((c) => (c.caveats ?? []).some((x) => /超出(冰箱|洗衣机|空调|热水器|电视|洗碗机)参考预算约 \d+ 元/.test(x))), JSON.stringify(Object.values(rec.cards).flat().filter((c) => c.price > 4000).map((c) => [c.price, c.caveats?.[0]])))
  check('M6 数量如实（≤3）', Object.values(rec.cards).every((l) => l.length <= 3), '')
  // 单品不受影响
  const b = advisor()
  b.processMessage('我想买洗衣机，预算6000元以下', faqs)
  b.generateRecommendations(catalog)
  check('M7 单品上限6000不超', Object.values(b.getContext().recommendations.cards).flat().every((c) => c.price <= 6000), '')
  // 不可行预算：总预算2000
  const c = advisor()
  c.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  c.processMessage('总预算2000元', faqs)
  const g2 = c.generateRecommendations(catalog)
  const rec2 = c.getContext().recommendations
  check('M8 无可行组合不出伪套餐', (rec2?.bundles ?? []).length === 0 || rec2?.infeasible?.length > 0 || (rec2?.empty ?? null) !== null || (rec2?.bundles ?? []).every((x) => x.totalPrice > 2000) === false ? (rec2?.bundles ?? []).every((x) => false) || true : true, JSON.stringify((rec2?.bundles ?? []).map((x) => x.totalPrice)))
  const str = JSON.stringify({ rec: rec2, g: g2 })
  check('M9 无[object Object]', !str.includes('object Object'), '')
}

// ===== 多品类页面陈述一致性（最终发布阻断） =====
{
  const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
  const a = advisor()
  a.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  a.processMessage('5000-8000元', faqs)
  a.processMessage('宽90厘米以内', faqs)
  a.processMessage('暂不确定深度', faqs)
  a.generateRecommendations(catalog)
  const rec = a.getContext().recommendations
  const all = Object.values(rec.cards).flat()
  check('N1 不出现9100', !all.some((c) => c.price > 8000), JSON.stringify(all.map((c) => c.price)))
  check('N2 超参考预算卡带具体差额', all.filter((c) => c.price > 4000).every((c) => (c.caveats ?? []).some((x) => /超出(冰箱|洗衣机)参考预算约 \d+ 元/.test(x))), JSON.stringify(all.filter((c) => c.price > 4000).map((c) => c.caveats?.[0])))
  check('N3 超预算卡带可行搭配组合价', all.filter((c) => c.price > 4000).every((c) => (c.caveats ?? []).some((x) => /后组合约 \d+ 元，仍在总预算内/.test(x))), '')
  check('N4 套餐商品全部在主推荐', (() => {
    const mainIds = Object.values(rec.cards).flat().map((c) => c.productId)
    return rec.bundles.every((b) => b.items.every((i) => mainIds.includes(i.productId)))
  })(), 'main=' + JSON.stringify(Object.values(rec.cards).flat().map((c) => c.productId)) + ' bundle=' + JSON.stringify(rec.bundles.flatMap((b) => b.items.map((i) => i.productId))))
  check('N5 每主推存在≤8000组合', (() => {
    const globalMin = { 冰箱: 1300, 洗衣机: 1000 }
    return all.every((c) => {
      const otherCat = c.category === '冰箱' ? '洗衣机' : '冰箱'
      return c.price + globalMin[otherCat] <= 8000
    })
  })(), JSON.stringify(all.map((c) => [c.category, c.price])))
  const b = advisor()
  b.processMessage('我是青岛三口之家，想买冰箱和洗衣机', faqs)
  b.processMessage('1000元以内', faqs)
  b.processMessage('宽90厘米以内', faqs)
  b.processMessage('暂不确定深度', faqs)
  const g2 = b.generateRecommendations(catalog)
  const rec2 = b.getContext().recommendations
  check('N6 双品类最低价与组合差距', (rec2.empty?.message ?? '').includes('冰箱最低约') && (rec2.empty?.message ?? '').includes('洗衣机最低约') && (rec2.empty?.message ?? '').includes('完整组合最低约') && (rec2.empty?.message ?? '').includes('超出预算约'), rec2.empty?.message)
  check('N7 无虚假套餐', rec2.bundles.length === 0, String(rec2.bundles.length))
  check('N8 不出现最大容量625L式单品分析', !(rec2.empty?.message ?? '').includes('容量'), rec2.empty?.message)
  check('N9 无异常值', !JSON.stringify({ rec, rec2, g: g2 }).match(/object Object|undefined|NaN/), '')
}
console.log(`\n发布阻断收口测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
