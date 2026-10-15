// 专项修复回归：偏好上下文 / 开放预算显示 / 不变量（先失败后修复）
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore, MemoryStorage } from '../frontend/src/engine/session.ts'
import { readFileSync } from 'node:fs'
import { formatBudget } from '../frontend/src/engine/budget.ts'
const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url)))
const catalog = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url)))
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
function newAdvisor() { return new Advisor(new SessionStore(new MemoryStorage())) }
const BAD = ['undefined', 'NaN', '[object Object]', 'Infinity', '-null', 'null 元']

// ===== 一/二/三：偏好回答路径A =====
{
  const a = newAdvisor()
  a.processMessage('想买冰箱', faqs)
  a.processMessage('8000元以上', faqs)
  a.processMessage('5人以上', faqs)
  const r4 = a.processMessage('性价比高', faqs)
  check('P1 性价比高不进兜底', !r4.reply.includes('没有完全理解'), r4.reply.slice(0, 50))
  check('P2 记录偏好并确认', r4.reply.includes('性价比'), r4.reply.slice(0, 50))
  check('P3 dialogueState=awaiting_preferences或就绪', ['awaiting_preferences', 'ready_for_recommendation', 'idle'].includes(r4.dialogueState), `state=${r4.dialogueState}`)
  check('P4 无异常值', !BAD.some(b => r4.reply.includes(b)), r4.reply.slice(0, 60))
}
{
  const a = newAdvisor()
  a.processMessage('想买冰箱', faqs)
  a.processMessage('8000元以上', faqs)
  a.processMessage('5人以上', faqs)
  // 10条偏好短回答
  const cases = [
    ['性价比高', ['cost_effective'], []],
    ['划算一点', ['cost_effective'], []],
    ['省电最重要', ['energy_saving'], []],
    ['晚上别太吵', ['quiet'], []],
    ['容量越大越好', ['large_capacity'], []],
    ['老人用，简单一点', ['easy_operation'], []],
    ['不要性价比，静音优先', ['quiet'], ['cost_effective']],
    ['节能和静音都重要', ['energy_saving', 'quiet'], []],
    ['性价比不是重点', [], ['cost_effective']],
    ['随便，没有特别偏好', [], []]
  ]
  let i = 0
  for (const [text, want, notWant] of cases) {
    i++
    const a2 = i === 1 ? a : newAdvisor()
    if (i > 1) { a2.processMessage('想买冰箱', faqs); a2.processMessage('8000元以上', faqs); a2.processMessage('5人以上', faqs) }
    const r = a2.processMessage(text, faqs)
    const prefs = (a2.getContext().slots.preferences?.value ?? [])
    check(`Q${i} ${text} 偏好记录`, want.every(w => prefs.includes(w)) && notWant.every(n => !prefs.includes(n)), JSON.stringify(prefs))
    check(`Q${i} ${text} 不进兜底`, !r.reply.includes('没有完全理解'), r.reply.slice(0, 40))
  }
}
// 不变量：槽位变化后永不兜底
{
  const a = newAdvisor()
  const r = a.processMessage('帮老人挑个实惠的冰箱', faqs)
  const changed = r.slotChanges.length > 0
  check('INV 有槽位变化则不兜底', !(changed && r.reply.includes('没有完全理解')), `changes=${changed}`)
}
// ===== 四：开放预算格式化 =====
{
  check('F1 min-only', formatBudget({ min: 8000, max: null }) === '8000元以上', formatBudget({ min: 8000, max: null }))
  check('F2 max-only', formatBudget({ min: null, max: 8000 }) === '8000元以内', formatBudget({ min: null, max: 8000 }))
  check('F3 区间', formatBudget({ min: 5000, max: 8000 }) === '5000～8000元', formatBudget({ min: 5000, max: 8000 }))
  check('F4 约', formatBudget({ approximate: 8000 }) === '约8000元', formatBudget({ approximate: 8000 }))
  check('F5 精确', formatBudget({ exact: 8000 }) === '8000元', formatBudget({ exact: 8000 }))
  check('F6 未设置', formatBudget({}) === '未设置预算', formatBudget({}))
  check('F7 非首要', formatBudget({ moneyNotPrimary: true }) === '价格不是首要条件', formatBudget({ moneyNotPrimary: true }))
  const fmtAll = [8000, null, undefined].flatMap((m1) => [null, undefined, 8000].map((m2) => formatBudget({ min: m1, max: m2 })))
  check('F8 无NaN/undefined', !fmtAll.some((x) => BAD.some((b) => x.includes(b))), fmtAll.join('|'))
}
// 开放预算推荐计算无 undefined 且不过滤全部
{
  const a = newAdvisor()
  a.processMessage('想买冰箱', faqs)
  a.processMessage('8000元以上', faqs)
  a.processMessage('5人以上', faqs)
  a.processMessage('大容量', faqs)
  const gen = a.generateRecommendations(catalog)
  check('R1 下限预算可生成推荐', !gen.refused, JSON.stringify(gen.refused ?? {}))
  const rec = a.getContext().recommendations
  const all = JSON.stringify({ cards: rec.cards, empty: rec.empty })
  check('R2 推荐结果无undefined/NaN', !BAD.some(b => all.includes(b)), '')
  const cards = Object.values(rec.cards).flat()
  check('R3 下限预算未被清空', cards.length > 0, `cards=${cards.length}`)
  check('R4 商品价格满足下限', cards.every(c => c.price >= 8000), JSON.stringify(cards.map(c => c.price)))
  const filterRows = JSON.stringify(rec.empty?.filterReport ?? rec.cards)
  check('R5 过滤报告无 -undefined', !filterRows.includes('-undefined') && !filterRows.includes('undefined 元'), '')
}
// 刷新恢复
{
  const storage = new MemoryStorage()
  const a1 = new Advisor(new SessionStore(storage))
  a1.processMessage('想买冰箱', faqs)
  a1.processMessage('8000元以上', faqs)
  a1.processMessage('性价比高', faqs)
  const a2 = new Advisor(new SessionStore(storage))
  const ctx = a2.getContext()
  check('S1 刷新后预算下限保留', ctx.slots.itemBudgetRange?.value?.min === 8000, JSON.stringify(ctx.slots.itemBudgetRange))
  check('S2 刷新后偏好保留', (ctx.slots.preferences?.value ?? []).includes('cost_effective'), JSON.stringify(ctx.slots.preferences))
}
console.log(`\n专项修复回归: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
