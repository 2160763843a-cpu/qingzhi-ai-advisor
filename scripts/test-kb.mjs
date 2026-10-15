// 知识库评测：Top1 准确率 / Top3 命中率 / 未命中处理 / 耗时
// 运行: node scripts/test-kb.mjs（Top1 目标 >= 80%）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchFaq } from '../frontend/src/engine/kb.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const faqs = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'faqs.json'), 'utf8'))
const cases = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'kb-eval.json'), 'utf8'))

let top1 = 0, top3 = 0, missOk = 0
let missTotal = 0
let totalTime = 0, maxTime = 0
const failures = []

for (const c of cases) {
  const t0 = performance.now()
  const m = searchFaq(c.text, faqs, {})
  const ms = Math.round((performance.now() - t0) * 100) / 100
  totalTime += ms
  maxTime = Math.max(maxTime, ms)

  if (c.expectFaqId === null) {
    missTotal += 1
    if (m.confidence !== 'high') missOk += 1
    else failures.push(`[${c.id}] "${c.text}" 无对应条目却高置信度直答 ${m.matchedFaqId}`)
    continue
  }
  const top3Ids = [m.matchedFaqId, ...m.alternativeFaqs.map((x) => x.id)].filter(Boolean)
  if (m.matchedFaqId === c.expectFaqId) top1 += 1
  else if (!m.matchedFaqId && m.confidence === 'low') {
    failures.push(`[${c.id}] "${c.text}" 期望 ${c.expectFaqId}，实际未命中 (score=${m.matchScore})`)
    continue
  }
  if (top3Ids.includes(c.expectFaqId)) top3 += 1
  else failures.push(`[${c.id}] "${c.text}" 期望 ${c.expectFaqId}，Top3 未命中（Top1=${m.matchedFaqId}, 分=${m.matchScore}）`)
}

const total = cases.length - missTotal
const rate1 = Math.round((top1 / total) * 1000) / 10
const rate3 = Math.round((top3 / total) * 1000) / 10
console.log('========== 知识库评测报告（模拟测试集） ==========')
console.log(`案例: ${cases.length}（含未命中 ${missTotal}）| Top1 准确率: ${top1}/${total} (${rate1}%) | Top3 命中: ${top3}/${total} (${rate3}%)`)
console.log(`未命中正确拒绝: ${missOk}/${missTotal} | 平均耗时: ${Math.round((totalTime / cases.length) * 100) / 100}ms | 最慢: ${maxTime}ms`)
if (failures.length) { console.error('失败明细:'); for (const f of failures) console.error('  [FAIL] ' + f) }
process.exit(rate1 >= 80 && failures.length === 0 ? 0 : 1)
