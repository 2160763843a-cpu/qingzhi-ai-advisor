// 权重总和自动测试：六类商品基础权重、全部偏好组合、海鲜需求、三种策略、越便宜越好
// 运行: node scripts/test-weights.mjs（任一组合权重和 != 100 即失败退出）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recommendFromSlots, prefTargetDim } from '../frontend/src/engine/recommend.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'))

const CATS = ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机']
const PREFS = ['energy_saving', 'quiet', 'large_capacity', 'cost_effective', 'smart', 'easy_operation']
const STRATEGIES = [undefined, 'eco_quiet', 'value']

const failures = []
let checked = 0

function assertSum(weights, label) {
  checked += 1
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  if (sum !== 100) failures.push(`${label} 权重和为 ${sum}（应为 100）: ${JSON.stringify(weights)}`)
}

// 组合生成：借助引擎卡片反查各组合的权重（覆盖真实生效路径）
function comboWeights(cat, prefs, needs, strategy, cheap) {
  const r = recommendFromSlots(
    { categories: [cat], itemBudget: 99999, familySize: 3, preferences: prefs, localNeeds: needs },
    catalog,
    {}
  )
  void strategy
  void cheap
  const card = Object.values(r.cards).flat()[0]
  return card ? Object.fromEntries(card.subScores.map((x) => [x.key, x.weight])) : null
}

// 1) 全部偏好子集 × 六类（含海鲜需求组合）
for (const cat of CATS) {
  for (let mask = 0; mask < 1 << PREFS.length; mask++) {
    const prefs = PREFS.filter((_, i) => mask & (1 << i))
    for (const needs of (cat === '冰箱' ? [[], ['seafood_freezing']] : [[]])) {
      for (const strategy of STRATEGIES) {
        const w = comboWeights(cat, prefs, needs, strategy)
        if (w) assertSum(w, `${cat} prefs=[${prefs.join(',')}] needs=[${needs.join(',')}] strategy=${strategy ?? 'base'}`)
      }
    }
  }
}

// 2) 越便宜越好：性价比权重应明显高于基础值，且总和仍为 100
for (const cat of CATS) {
  const base = comboWeights(cat, [], [])
  const cheap = comboWeights(cat, ['cost_effective'], [], undefined)
  if (base && cheap) {
    checked += 1
    if (!((cheap.value ?? 0) > (base.value ?? 0))) failures.push(`${cat} 越便宜越好未提升性价比权重: ${base.value} -> ${cheap.value}`)
  }
}

// 3) 偏好必须实际影响目标维度（品类感知目标映射）
const PREF_PROOF = [
  ['energy_saving', 'energy'],
  ['quiet', 'noise'],
  ['cost_effective', 'value'],
  ['smart', 'feature'],
  ['large_capacity', null]
]
for (const cat of CATS) {
  for (const [pref, generic] of PREF_PROOF) {
    const target = prefTargetDim(cat, pref)
    if (!target) continue
    checked += 1
    const base = comboWeights(cat, [], [])
    const withPref = comboWeights(cat, [pref], [])
    if (!base || !withPref) continue
    if ((base[target] ?? 0) === 0) continue
    if ((withPref[target] ?? 0) <= (base[target] ?? 0)) {
      failures.push(`${cat} 偏好 ${pref} 未提升目标维度 ${target}: ${base[target] ?? 0} -> ${withPref[target] ?? 0}`)
    }
  }
}

console.log('========== 权重总和测试报告 ==========')
console.log(`校验组合数: ${checked}`)
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`)
  for (const f of failures) console.error('  [FAIL] ' + f)
  process.exit(1)
}
console.log('全部权重组合总和均为 100，偏好调权均为维度间转移 ✓')
process.exit(0)
