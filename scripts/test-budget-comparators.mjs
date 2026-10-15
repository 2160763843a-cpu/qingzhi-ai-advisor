// 预算比较符语义解析测试：15 组口语预算表达
import { extractSlots } from '../frontend/src/engine/extractor.ts'
import { createSessionContext } from '../frontend/src/engine/session.ts'
const intent = { primaryIntent: 'pre_sale', confidence: 0.9, matchedSignals: [], alternativeIntent: null, needsClarification: false, clarificationQuestion: '', processingTimeMs: 0 }
function slotsOf(text) {
  const ctx = createSessionContext()
  const us = extractSlots(text, ctx, intent, 1).filter((u) => !String(u.key).includes('__'))
  return { ctx, us }
}
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) pass++; else { fail++; failures.push(`${name} ${detail}`) } }
function budgetOf(text) {
  const { ctx, us } = slotsOf(text)
  for (const u of us) {
    if (u.mode === 'merge') {
      const prev = ctx.slots[u.key]?.value ?? {}
      ctx.slots[u.key] = { value: { ...prev, ...(u.value ?? {}) }, turn: 1, raw: text }
    } else {
      ctx.slots[u.key] = { value: u.value, turn: 1, raw: text }
    }
  }
  const s = ctx.slots
  return { range: s.itemBudgetRange?.value, item: s.itemBudget?.value, total: s.totalBudget?.value, note: s.budgetNote?.value, prefs: s.preferences?.value, detail: us.map((u) => u.detail).join('|') }
}
let r
r = budgetOf('10000元以上'); check('1 10000元以上→min=10000,max=null', r.range?.min === 10000 && r.range?.max === undefined && r.detail.includes('下限'), r.detail)
r = budgetOf('至少10000元'); check('2 至少10000元→min', r.range?.min === 10000, r.detail)
r = budgetOf('10000元起'); check('3 10000元起→min', r.range?.min === 10000, r.detail)
r = budgetOf('10000元以内'); check('4 10000元以内→max=10000', r.item === 10000 && !r.range, r.detail)
r = budgetOf('不超过10000元'); check('5 不超过10000元→strictMax', r.item === 10000 && r.detail.includes('不超过'), r.detail)
r = budgetOf('5000到8000元'); check('6 5000到8000→range', r.range?.min === 5000 && r.range?.max === 8000 && r.detail.includes('区间'), r.detail)
r = budgetOf('8000元左右'); check('7 8000元左右→approximate', r.item === 8000 && r.detail.includes('约'), r.detail)
r = budgetOf('大概8000元'); check('8 大概8000元→approximate', r.item === 8000 && r.detail.includes('约'), r.detail)
r = budgetOf('预算没有上限'); check('9 预算没有上限→max=null无数字', r.note === '预算无上限' && !r.item && !r.total && !r.range, JSON.stringify(r.note))
r = budgetOf('钱不是问题'); check('10 钱不是问题→不虚构数字', r.note === '价格非首要条件' && !r.item && !r.total && !r.range, JSON.stringify(r.note))
r = budgetOf('越便宜越好'); check('11 越便宜越好→性价比偏好', JSON.stringify(Object.values(r.prefs ?? {})).includes('cost_effective'), JSON.stringify(r.prefs))
r = budgetOf('一万多'); check('12 一万多→模糊区间并确认', r.range?.min === 10000 && r.range?.max === 15000 && r.detail.includes('约'), r.detail)
r = budgetOf('每件不超过5000元'); check('13 每件不超过5000元→单品上限', r.item === 5000 && r.detail.includes('单品预算上限'), r.detail)
r = budgetOf('两件总共8000元'); check('14 两件总共8000元→组合总预算', r.total === 8000, r.detail)
r = budgetOf('一万往上'); check('15 一万往上→min=10000', r.range?.min === 10000, r.detail)
console.log(`\n预算比较符解析: 通过 ${pass}/${pass + fail}`)
if (failures.length) for (const f of failures) console.log(' - ' + f)
process.exit(fail > 0 ? 1 : 0)
