// 部署一致性检查：公网/本地服务 HTML ↔ /api/build-info ↔ 本地 dist ↔ 新DOM标记
import { readFileSync } from 'node:fs'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
let fail = 0
function check(name, cond, detail = '') { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ` :: ${detail}`)); if (!cond) fail++ }
const info = await (await fetch(`${BASE}/api/build-info`)).json()
const html = await (await fetch(`${BASE}/?nocache=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } })).json ? await (await fetch(`${BASE}/?nocache=${Date.now()}`)).text() : ''
const served = html.match(/assets\/[^"]+/g) ?? []
const local = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').match(/assets\/[^"]+/g) ?? []
check('build-info 与本地 HTML 资源一致', info.assets.js && served.includes(`assets/${info.assets.js}`), JSON.stringify(info.assets))
check('服务 HTML 与本地 dist 一致', JSON.stringify(served.sort()) === JSON.stringify(local.sort()), `${served} vs ${local}`)
const mainJs = await (await fetch(`${BASE}/assets/${info.assets.js}`)).text()
check('新DOM: 运营中心', mainJs.includes('运营中心'), '')
check('新DOM: 移动菜单按钮', mainJs.includes('菜单'), '')
// 懒加载 chunk 全量检查（本地定位含标记的 chunk，再从服务端取同文件验证）
import { readdirSync } from 'node:fs'
const MARKS = ['本地混合 NLU 驱动', '让客服不止回答问题']
const badOld = ['您好，我是青智家 AI 顾问', '数据接口正常', '想买一台静音的冰箱']
for (const mark of MARKS) {
  const chunk = readdirSync(new URL('../dist/assets/', import.meta.url)).find((f) => f.endsWith('.js') && readFileSync(new URL(`../dist/assets/${f}`, import.meta.url), 'utf8').includes(mark))
  check(`新DOM: ${mark} 所在chunk存在`, Boolean(chunk), '')
  if (chunk) {
    const served = await (await fetch(`${BASE}/assets/${chunk}`)).text()
    check(`新DOM: ${mark}（服务端chunk）`, served.includes(mark), chunk)
  }
}
const allServed = [info.assets.js, info.assets.css]
check('旧DOM: 无旧欢迎卡/调试条/旧placeholder', !badOld.some((b) => mainJs.includes(b)), '')
for (const b of badOld) {
  const chunk = readdirSync(new URL('../dist/assets/', import.meta.url)).find((f) => f.endsWith('.js') && readFileSync(new URL(`../dist/assets/${f}`, import.meta.url), 'utf8').includes(b))
  check(`旧DOM: ${b} 不存在于任何chunk`, !chunk, chunk ?? '')
}
void allServed
check('状态修改下 build-info 恒有 commit', info.gitCommit && info.gitCommit !== 'unknown', info.gitCommit)
const routes = ['', 'chat', 'products', 'compare', 'leads', 'dashboard', 'kb', 'about']
for (const r of routes) {
  const res = await fetch(`${BASE}/${r}`)
  check(`路由 /${r} = 200`, res.status === 200, String(res.status))
}
// 旧产物资源应 404
const oldRes = await fetch(`${BASE}/assets/index-DHNjlZnz.js`)
check('旧产物资源不再可访问(404)', oldRes.status === 404, String(oldRes.status))
console.log(fail === 0 ? '部署一致性: 全部通过' : `部署一致性: ${fail} 项失败`)
process.exit(fail > 0 ? 1 : 0)
