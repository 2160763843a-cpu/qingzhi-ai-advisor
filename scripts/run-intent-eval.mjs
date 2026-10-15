// 意图识别评测：72 条独立评测语句，输出准确率/混淆矩阵/低置信度/误判明细/耗时
// 运行: node scripts/run-intent-eval.mjs（目标总体准确率 >= 85%）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recognizeIntent } from '../frontend/src/engine/recognizer.ts'
import { createSessionContext } from '../frontend/src/engine/session.ts'
import { ALL_INTENTS } from '../frontend/src/engine/types.ts'
import { INTENT_LABELS } from '../frontend/src/engine/labels.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const items = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'intent-eval.json'), 'utf8'))

const confusion = {}
for (const e of ALL_INTENTS) confusion[e] = {}
for (const e of ALL_INTENTS) for (const p of ALL_INTENTS) confusion[e][p] = 0

const failures = []
let correct = 0
let lowConfidence = 0
let totalTime = 0
let maxTime = 0

for (const item of items) {
  const ctx = createSessionContext()
  const result = recognizeIntent(item.text, ctx)
  totalTime += result.processingTimeMs
  maxTime = Math.max(maxTime, result.processingTimeMs)
  confusion[item.expectedIntent][result.primaryIntent] += 1
  if (result.confidence < 0.6) lowConfidence += 1
  if (result.primaryIntent === item.expectedIntent) {
    correct += 1
  } else {
    failures.push({
      id: item.id,
      difficulty: item.difficulty,
      text: item.text,
      expected: item.expectedIntent,
      predicted: result.primaryIntent,
      confidence: result.confidence,
      signals: result.matchedSignals.map((s) => `${s.word}(${s.intent}:${s.weight})`).join(', ')
    })
  }
}

const total = items.length
const accuracy = Math.round((correct / total) * 1000) / 10
const perClass = {}
for (const e of ALL_INTENTS) {
  const rowTotal = Object.values(confusion[e]).reduce((a, b) => a + b, 0)
  perClass[e] = rowTotal === 0 ? 'n/a' : Math.round((confusion[e][e] / rowTotal) * 1000) / 10
}

console.log('========== 意图识别评测报告（模拟测试集） ==========')
console.log(`评测语句: ${total} 条 | 正确: ${correct} | 总体准确率: ${accuracy}% (目标 >= 85%)`)
console.log(`低置信度(<0.6)条数: ${lowConfidence} | 平均耗时: ${Math.round((totalTime / total) * 100) / 100}ms | 最慢耗时: ${maxTime}ms`)
console.log('\n各类别准确率:')
for (const e of ALL_INTENTS) console.log(`  ${INTENT_LABELS[e]}: ${perClass[e]}%`)
console.log('\n混淆矩阵 (行=期望, 列=预测):')
const short = { pre_sale: 'PS', comparison: 'CP', after_sale: 'AS', complaint: 'PL', purchase_intent: 'PI', chitchat_unknown: 'CK' }
console.log('      ' + ALL_INTENTS.map((i) => short[i].padStart(4)).join(''))
for (const e of ALL_INTENTS) {
  console.log(short[e].padStart(5) + ' ' + ALL_INTENTS.map((p) => String(confusion[e][p]).padStart(4)).join(''))
}
if (failures.length > 0) {
  console.log(`\n误判样例 (${failures.length} 条):`)
  for (const f of failures) {
    console.log(`  [${f.id}|${f.difficulty}] "${f.text}"`)
    console.log(`    期望: ${f.expected} | 预测: ${f.predicted} (conf=${f.confidence})`)
    console.log(`    命中信号: ${f.signals || '(无)'}`)
  }
} else {
  console.log('\n无误判样例')
}

process.exit(accuracy >= 85 ? 0 : 1)
