// CompareStore 响应性 + 事件去重 + 损坏恢复 测试（修复前应失败）
import { CompareStore, MemoryCompareStorage, MAX_COMPARE } from '../frontend/src/stores/compare.ts'
import { readFileSync } from 'node:fs'
const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
const by = (id) => catalog.find((p) => p.id === id)
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }

// 1) 响应式 count/canCompute
{
  const s = new CompareStore(new MemoryCompareStorage(), 'k1', 'S-A')
  check('R1 count 初始为0', s.count === 0, String(s.count))
  s.add(by('RF-01'), '商品库')
  check('R2 add 后 count 即时为1（无需手动刷新）', s.count === 1, String(s.count))
  check('R3 canCompare=false', s.canCompare === false, '')
  s.add(by('RF-02'), '商品库')
  check('R4 count=2 且 canCompare=true', s.count === 2 && s.canCompare === true, '')
  check('R5 category=冰箱', s.category === '冰箱', s.category)
  s.add(by('RF-03'), '商品库')
  check('R6 isFull', s.isFull === true && s.count === MAX_COMPARE, '')
  s.remove('RF-02')
  check('R7 remove 后 count 即时变化', s.count === 2 && !s.has('RF-02'), String(s.count))
  check('R8 has() 判定', s.has('RF-01') && !s.has('RF-02'), '')
}

// 2) 事件去重
{
  const s = new CompareStore(new MemoryCompareStorage(), 'k2', 'S-B')
  s.add(by('RF-01'), '商品库')
  s.add(by('RF-01'), '商品库') // duplicate
  s.add(by('RF-02'), '商品库')
  const added = s.events.filter((e) => e.type === 'compare_item_added')
  const started = s.events.filter((e) => e.type === 'compare_started')
  check('D1 duplicate 不写 added 事件', added.length === 2, JSON.stringify(added.map((e) => e.productId)))
  check('D2 compare_started 仅一次', started.length === 1, String(started.length))
  s.remove('RF-01')
  check('D3 移除记录一次', s.events.filter((e) => e.type === 'compare_item_removed').length === 1, '')
  // 移除后重新加入两款：started 不重复记录（生命周期内一次）
  s.remove('RF-02')
  s.add(by('RF-03'), '商品库')
  s.add(by('RF-02'), '商品库')
  check('D4 started 全生命周期一次', s.events.filter((e) => e.type === 'compare_started').length === 1, String(s.events.filter((e) => e.type === 'compare_started').length))
  // 刷新恢复不产生新的 added 事件
  const storage = new MemoryCompareStorage()
  const s1 = new CompareStore(storage, 'k3', 'S-C')
  s1.add(by('RF-01'), '商品库')
  const before = s1.events.filter((e) => e.type === 'compare_item_added').length
  const s2 = new CompareStore(storage, 'k3', 'S-C')
  s2.restore()
  check('D5 restore 不新增 added 事件', s2.events.filter((e) => e.type === 'compare_item_added').length === before, '')
  // viewed 节流
  s2.recordView()
  s2.recordView()
  s2.recordView()
  check('D6 viewed 连续调用去重', s2.events.filter((e) => e.type === 'compare_viewed').length === 1, String(s2.events.filter((e) => e.type === 'compare_viewed').length))
}
// 3) 损坏 localStorage 安全回退
{
  const storage = new MemoryCompareStorage()
  storage.setItem('k4', '{corrupted!!!')
  let s
  let threw = false
  try { s = new CompareStore(storage, 'k4', 'S-D'); s.restore() } catch { threw = true }
  check('D7 损坏数据不抛错且为空状态', !threw && s.items.length === 0, String(threw))
}
// 4) persist/restore 往返
{
  const storage = new MemoryCompareStorage()
  const s1 = new CompareStore(storage, 'k5', 'S-E')
  s1.add(by('RF-01'), '商品库')
  s1.persist()
  const s2 = new CompareStore(storage, 'k5', 'S-E')
  s2.restore()
  check('D8 persist/restore 往返', s2.items.length === 1 && s2.items[0].productId === 'RF-01', JSON.stringify(s2.items))
}
// 5) 导航静态断言：RouterLink 标准实现
{
  const app = readFileSync(new URL('../frontend/src/App.vue', import.meta.url), 'utf8')
  const routes = ['/', '/chat', '/products', '/compare', '/kb', '/about']
  check('N1 六个导航项均为 RouterLink（v-for 配置）', /RouterLink[\s\S]*?:to="item.to"/.test(app) && routes.every((r) => app.includes(`to: '${r}'`)), routes.filter((r) => !app.includes(`to: '${r}'`)).join(','))
  check('N2 激活态绑定当前路由', /:class="[^"]*route\.path/.test(app) || /active/.test(app), '')
  check('N3 不再依赖 el-menu router 模式', !/el-menu-item/.test(app), '')
}
console.log(`\n对比响应性与导航回归: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
