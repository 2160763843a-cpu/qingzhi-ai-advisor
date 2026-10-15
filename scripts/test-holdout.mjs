// 留出测试：六类意图混淆矩阵/各类准确率/澄清率/失败样例（本脚本不得用于调参）
import { recognizeIntent } from '../frontend/src/engine/recognizer.ts'
import { createSessionContext } from '../frontend/src/engine/session.ts'
import { readFileSync } from 'node:fs'
const data = JSON.parse(readFileSync(new URL('../data/intent-holdout.json', import.meta.url)))
const INTENTS = ['pre_sale', 'comparison', 'after_sale', 'complaint', 'purchase_intent', 'chitchat_unknown']
const LABELS = { pre_sale: '售前', comparison: '比较', after_sale: '售后', complaint: '投诉', purchase_intent: '意向', chitchat_unknown: '闲聊' }
const matrix = {}
for (const e of INTENTS) matrix[e] = {}
for (const e of INTENTS) for (const p of INTENTS) matrix[e][p] = 0
let total = 0, correct = 0, clarified = 0
const clsStat = {}
for (const e of INTENTS) clsStat[e] = { total: 0, correct: 0, clarified: 0 }
const failures = []
for (const [id, text, expected] of data.cases) {
  const ctx = createSessionContext()
  const r = recognizeIntent(text, ctx)
  const predicted = r.needsClarification ? 'chitchat_unknown' : r.primaryIntent
  total++
  clsStat[expected].total++
  matrix[expected][predicted] = (matrix[expected][predicted] ?? 0) + 1
  if (r.needsClarification) { clarified++; clsStat[expected].clarified++ }
  if (predicted === expected) { correct++; clsStat[expected].correct++ }
  else failures.push(`${id} [${text}] 期望 ${LABELS[expected]}(${expected}) 实际 ${LABELS[predicted]}(${predicted}) conf=${r.confidence}`)
}
console.log('===== 留出测试集（独立评测，130条） =====')
console.log('混淆矩阵（行=期望，列=预测）:')
console.log('        ' + INTENTS.map((i) => LABELS[i].padEnd(4)).join(' '))
for (const e of INTENTS) {
  console.log(LABELS[e].padEnd(4) + '  ' + INTENTS.map((p) => String(matrix[e][p]).padEnd(5)).join(' '))
}
console.log('\n各类准确率:')
for (const e of INTENTS) {
  const acc = clsStat[e].total ? Math.round((clsStat[e].correct / clsStat[e].total) * 1000) / 10 : 0
  console.log(`  ${LABELS[e]}(${e}): ${clsStat[e].correct}/${clsStat[e].total} = ${acc}%`)
}
const overall = Math.round((correct / total) * 1000) / 10
const clarifyRate = Math.round((clarified / total) * 1000) / 10
const chitchatHandled = Math.round((matrix.chitchat_unknown.chitchat_unknown / Math.max(1, clsStat.chitchat_unknown.total)) * 1000) / 10
console.log(`\n总体准确率: ${correct}/${total} = ${overall}%（目标 ≥85%）`)
console.log(`低置信度澄清率: ${clarified}/${total} = ${clarifyRate}%`)
console.log(`闲聊正确率（含澄清归类）: ${chitchatHandled}%（目标 ≥90%）`)
if (failures.length) {
  console.log(`\n失败样例（${failures.length}）:`)
  for (const f of failures) console.log(' - ' + f)
} else {
  console.log('\n无失败样例')
}
const classOk = INTENTS.every((e) => clsStat[e].correct / clsStat[e].total >= 0.7)
process.exit(overall >= 85 && classOk && chitchatHandled >= 90 ? 0 : 1)
