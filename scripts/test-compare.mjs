// 商品对比与决策解释专项测试（CompareStore / 对比指代 / 评分复用）
import { CompareStore, MAX_COMPARE, MemoryCompareStorage } from '../frontend/src/stores/compare.ts'
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore } from '../frontend/src/engine/session.ts'
import { compareFieldsFor, commonCompareFields } from '../frontend/src/engine/compareFields.ts'
import { readFileSync } from 'node:fs'
const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url)))
const byId = (id) => catalog.find((p) => p.id === id)
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
function newStore(sessionId = 'S-test') { return new CompareStore(new MemoryCompareStorage(), 'qzad.compare.test', sessionId) }

// 1/4/5/6: 加入、跨品类、移除、清空
{
  const s = newStore()
  const r1 = s.add(byId('RF-01'), '推荐卡')
  check('C1 第1款加入成功', r1.ok === true, JSON.stringify(r1))
  check('C2 加入事件', s.events.some((e) => e.type === 'compare_item_added' && e.productId === 'RF-01'), '')
  const r2 = s.add(byId('RF-03'), '推荐卡')
  check('C3 第2款加入并触发started', r2.ok === true && s.events.some((e) => e.type === 'compare_started'), '')
  const rDup = s.add(byId('RF-01'), '推荐卡')
  check('C4 重复加入被拒绝', rDup.ok === false && rDup.code === 'duplicate', JSON.stringify(rDup))
  const rCross = s.add(byId('WM-01'), '商品库')
  check('C5 跨品类被拦截', rCross.ok === false && rCross.code === 'category_mismatch' && rCross.existingCategory === '冰箱', JSON.stringify(rCross))
  check('C6 上限为3', MAX_COMPARE === 3, '')
  s.add(byId('RF-05'), '推荐卡')
  const rFull = s.add(byId('RF-07'), '推荐卡')
  check('C7 第4款触发full', rFull.ok === false && rFull.code === 'full', JSON.stringify(rFull))
  s.removeById('RF-03', '推荐卡')
  check('C8 移除生效且有事件', s.items.length === 2 && s.events.some((e) => e.type === 'compare_item_removed' && e.productId === 'RF-03'), '')
  s.clear('商品库')
  check('C9 清空生效且有事件', s.items.length === 0 && s.events.some((e) => e.type === 'compare_cleared'), '')
}
// 7/8: 持久化与失效修剪
{
  const storage = new MemoryCompareStorage()
  const s1 = new CompareStore(storage, 'qzad.compare.test2', 'S-1')
  s1.add(byId('RF-01'), '推荐卡')
  s1.add(byId('RF-03'), '商品库')
  const s2 = new CompareStore(storage, 'qzad.compare.test2', 'S-1')
  check('C10 刷新后保留', s2.items.length === 2, JSON.stringify(s2.items.map((i) => i.productId)))
  const removed = s2.prune(catalog.map((p) => p.id).filter((id) => id !== 'RF-03'))
  check('C11 失效ID自动移除并报告', removed.length === 1 && removed[0].productId === 'RF-03' && s2.items.length === 1, JSON.stringify(removed))
}
// 9: 缺失参数显示暂无数据
{
  const rows = compareFieldsFor('冰箱')
  const val = rows.map((r) => r.get(byId('RF-01'))).join('|')
  check('C12 冰箱字段无undefined/空串', !/undefined|null|NaN/.test(val) && !val.includes('||'), val.slice(0, 60))
  const common = commonCompareFields().map((r) => r.get(byId('RF-01'))).join('|')
  check('C13 通用字段完整', common.split('|').length >= 10, common.slice(0, 60))
}
// 10-12/14/15: 对话指代（基于对比列表）
{
  const a = new Advisor(new SessionStore(new MemoryCompareStorage()))
  a.processMessage('想买冰箱', faqs)
  a.processMessage('预算5000到8000元', faqs)
  a.processMessage('家里四口人', faqs)
  a.processMessage('大容量省电', faqs)
  const items = [byId('RF-05'), byId('RF-07'), byId('RF-09')].filter(Boolean)
  const r = a.processMessage('第一款和第三款比一下', faqs, items)
  check('C14 序号指代被理解', !r.reply.includes('没有完全理解') && r.reply.includes(items[0].name.split(' ')[1] ?? items[0].name) && r.reply.includes(items[2].name.split(' ')[1] ?? items[2].name), r.reply.slice(0, 80))
  const r2 = a.processMessage('哪款更安静', faqs, items)
  check('C15 更安静给出明确款', r2.reply.includes('更安静'), r2.reply.slice(0, 60))
  const r3 = a.processMessage('哪款适合四口之家', faqs, items)
  check('C16 家庭适配回答', !r3.reply.includes('没有完全理解'), r3.reply.slice(0, 60))
  const r4 = a.processMessage('第五款和第六款比一下', faqs, items)
  check('C17 序号越界明确提示', r4.reply.includes('只有 3 款') || r4.reply.includes('只有3款'), r4.reply.slice(0, 60))
  const r5 = a.processMessage('不比较第三款了', faqs, items)
  check('C18 移除指令返回动作', r5.compareAction?.type === 'remove' && r5.reply.includes('已从对比移除'), JSON.stringify(r5.compareAction))
  const r6 = a.processMessage('这两款哪个好', faqs, [])
  check('C19 无候选时引导选择', r6.reply.includes('还没有选定需要比较') || r6.reply.includes('先选择'), r6.reply.slice(0, 60))
}
// 11: 需求变化重算
{
  const a = new Advisor(new SessionStore(new MemoryCompareStorage()))
  a.processMessage('想买冰箱', faqs)
  a.processMessage('预算5000元以内', faqs)
  const items = [byId('RF-05'), byId('RF-07')]
  const r1 = a.processMessage('这两款哪个好', faqs, items)
  a.processMessage('预算改成20000元', faqs)
  const r2 = a.processMessage('这两款哪个好', faqs, items)
  check('C20 需求变化后结论变化', r1.reply !== r2.reply, r1.reply.slice(0, 40) + ' vs ' + r2.reply.slice(0, 40))
  const ctx = a.getContext()
  check('C21 对比不损坏需求槽位', ctx.slots.categories?.value?.[0] === '冰箱' && Boolean(ctx.slots.itemBudgetRange || ctx.slots.itemBudget || ctx.slots.itemBudgetByCategory), JSON.stringify({ r: ctx.slots.itemBudgetRange?.value, i: ctx.slots.itemBudget?.value, b: ctx.slots.itemBudgetByCategory?.value }))
}
console.log(`\n对比专项测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
