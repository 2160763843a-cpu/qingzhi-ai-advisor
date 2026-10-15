// 安全风险评测：召回率 / 误报率 / 分类型表现 / 处理耗时
// 运行: node scripts/test-safety.mjs（高风险召回率必须 100%）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectSafety } from '../frontend/src/engine/safety.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'safety-eval.json'), 'utf8'))

let emergencyTotal = 0, emergencyHit = 0
let cautionTotal = 0, cautionHit = 0
let noneTotal = 0, noneHit = 0
let falsePositives = 0
let totalTime = 0, maxTime = 0
const failures = []
const byType = {}

for (const c of cases) {
  const t0 = performance.now()
  const s = detectSafety(c.text)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  totalTime += ms
  maxTime = Math.max(maxTime, ms)

  if (c.expect === 'emergency') {
    emergencyTotal += 1
    byType[c.riskType] = byType[c.riskType] || { hit: 0, total: 0 }
    byType[c.riskType].total += 1
    const ok = s.safetyLevel === 'emergency' && (!c.riskType || s.riskType === c.riskType)
    if (ok) { emergencyHit += 1; byType[c.riskType].hit += 1 }
    else failures.push(`[${c.id}] "${c.text}" 期望 emergency/${c.riskType}，实际 ${s.safetyLevel}/${s.riskType}`)
    if (c.category && s.affectedCategory !== c.category) failures.push(`[${c.id}] 品类 期望 ${c.category}，实际 ${s.affectedCategory}`)
    if (ok && (s.immediateActions.length === 0 || s.prohibitedActions.length === 0)) failures.push(`[${c.id}] 安全动作/禁止事项缺失`)
  } else if (c.expect === 'caution') {
    cautionTotal += 1
    if (s.safetyLevel === 'caution') cautionHit += 1
    else failures.push(`[${c.id}] "${c.text}" 期望 caution，实际 ${s.safetyLevel}`)
  } else {
    noneTotal += 1
    if (s.safetyLevel === 'none') noneHit += 1
    else { falsePositives += 1; failures.push(`[${c.id}] "${c.text}" 误报为 ${s.safetyLevel}/${s.riskType}`) }
  }
}

const recall = emergencyTotal ? Math.round((emergencyHit / emergencyTotal) * 1000) / 10 : 100
const fpRate = noneTotal ? Math.round((falsePositives / noneTotal) * 1000) / 10 : 0
console.log('========== 安全风险评测报告（模拟测试集） ==========')
console.log(`案例: ${cases.length} | 高风险召回: ${emergencyHit}/${emergencyTotal} (${recall}%) | 谨慎咨询命中: ${cautionHit}/${cautionTotal} | 误报: ${falsePositives}/${noneTotal} (${fpRate}%)`)
console.log(`平均耗时: ${Math.round((totalTime / cases.length) * 100) / 100}ms | 最慢: ${maxTime}ms`)
for (const [t, v] of Object.entries(byType)) console.log(`  ${t}: ${v.hit}/${v.total}`)
if (failures.length) { console.error('失败明细:'); for (const f of failures) console.error('  [FAIL] ' + f) }
process.exit(recall === 100 && failures.length === 0 ? 0 : 1)
