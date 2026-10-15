// 预算语义自动测试：区间 / 以内 / 至少 / 严格上限 / 左右浮动 / 越便宜越好
// 运行: node scripts/test-budget-semantics.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recommendFromSlots } from '../frontend/src/engine/recommend.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'))

const failures = []
let checked = 0
function check(cond, label, detail) {
  checked += 1
  if (!cond) failures.push(`${label}: ${detail}`)
}
const budgetSub = (card) => card.subScores.find((x) => x.key === 'budget')

// ---- 1. 区间语义："5000～8000元" ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudgetRange: { min: 5000, max: 8000 }, familySize: 4 }, catalog)
  const cards = Object.values(r.cards).flat()
  check(cards.length > 0, '区间-有结果', '应返回候选')
  const inRange = cards.filter((c) => c.price >= 5000 && c.price <= 8000)
  const below = cards.filter((c) => c.price < 5000)
  check(inRange.length > 0, '区间-存在区间内商品', '无区间内候选')
  for (const c of inRange) {
    check(budgetSub(c)?.score === 100, '区间-内预算满分', `${c.productId} 预算分 ${budgetSub(c)?.score}`)
    check((budgetSub(c)?.reason ?? '').includes('区间'), '区间-理由语义', `${c.productId} ${budgetSub(c)?.reason}`)
  }
  for (const c of below) {
    check((budgetSub(c)?.score ?? 100) < 100, '区间-低于下限不得满分', `${c.productId} 预算分 ${budgetSub(c)?.score}`)
    check(c.caveats.some((x) => x.includes('低于期望区间')), '区间-低于下限必须标记', `${c.productId} caveats=${c.caveats.join('|')}`)
  }
  if (inRange.length > 0 && below.length > 0) {
    const maxIn = Math.max(...inRange.map((c) => budgetSub(c)?.score ?? 0))
    const maxBelow = Math.max(...below.map((c) => budgetSub(c)?.score ?? 0))
    check(maxIn > maxBelow, '区间-内得分高于低于区间', `区间内最高 ${maxIn} vs 低于区间最高 ${maxBelow}`)
  }
  for (const c of cards) check(c.price <= 8000, '区间-上限硬约束', `${c.productId} 价格 ${c.price} 超过 8000`)
}

// ---- 2. 上限语义："8000元以内"（无下限要求） ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 8000, familySize: 4 }, catalog)
  const cards = Object.values(r.cards).flat()
  for (const c of cards) {
    check(c.price <= 8000, '以内-上限硬约束', `${c.productId} 价格 ${c.price}`)
    check(!c.caveats.some((x) => x.includes('低于期望区间')), '以内-不得出现区间下限标记', `${c.productId}`)
  }
  const cheapest = cards.slice().sort((a, b) => a.price - b.price)[0]
  if (cheapest) check(budgetSub(cheapest)?.score === 100, '以内-低价也是满分匹配', `${cheapest.productId} 预算分 ${budgetSub(cheapest)?.score}`)
}

// ---- 3. 下限语义："至少5000元" ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudgetRange: { min: 5000 }, familySize: 4 }, catalog)
  const cards = Object.values(r.cards).flat()
  check(cards.length > 0, '至少-有结果', '应返回 ≥5000 元候选')
  for (const c of cards) {
    check(c.price >= 5000, '至少-下限硬约束', `${c.productId} 价格 ${c.price} 低于 5000`)
  }
}

// ---- 4. 严格上限："不能超过8000元" ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 8000, budgetStrict: true, familySize: 4 }, catalog)
  for (const c of Object.values(r.cards).flat()) {
    check(c.price <= 8000, '严格-上限硬约束', `${c.productId} 价格 ${c.price}`)
    check(!c.caveats.some((x) => x.includes('超出预算')), '严格-不得出现超预算待确认', `${c.productId}`)
  }
}

// ---- 5. 浮动语义："8000元左右" ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 8000, budgetFloating: true, familySize: 4 }, catalog)
  const cards = Object.values(r.cards).flat()
  for (const c of cards) {
    check(c.price <= 8800, '浮动-上浮上限 10%', `${c.productId} 价格 ${c.price}`)
    if (c.price > 8000) {
      check(c.caveats.some((x) => x.includes('超出预算')), '浮动-超出必须提示确认', `${c.productId} caveats=${c.caveats.join('|')}`)
      check((budgetSub(c)?.score ?? 100) < 100, '浮动-超出部分不得满分', `${c.productId}`)
    }
  }
}

// ---- 6. 越便宜越好：低价权重显著提升 ----
{
  const base = recommendFromSlots({ categories: ['冰箱'], itemBudget: 99999, familySize: 3 }, catalog)
  const cheap = recommendFromSlots({ categories: ['冰箱'], itemBudget: 99999, familySize: 3, preferences: ['cost_effective'], cheapPreference: true }, catalog)
  const c1 = Object.values(base.cards).flat()[0]
  const c2 = Object.values(cheap.cards).flat()[0]
  const v1 = c1.subScores.find((x) => x.key === 'value')?.weight ?? 0
  const v2 = c2.subScores.find((x) => x.key === 'value')?.weight ?? 0
  check(v2 > v1, '越便宜-性价比权重提升', `${v1} -> ${v2}`)
  const sum2 = c2.subScores.reduce((a, b) => a + b.weight, 0)
  check(sum2 === 100, '越便宜-权重和仍为 100', `实际 ${sum2}`)
  check(c2.price <= c1.price, '越便宜-Top1 价格不高于基准', `${c1.price} -> ${c2.price}`)
}

// ---- 7. 主回归场景：冰箱 5000～8000元 四口 节能 无尺寸 ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudgetRange: { min: 5000, max: 8000 }, familySize: 4, preferences: ['energy_saving'] }, catalog)
  const cards = Object.values(r.cards).flat()
  check(cards.length > 0 && cards.length <= 3, '回归-数量 1~3', `实际 ${cards.length}`)
  for (const c of cards) {
    check(c.sizeFitStatus === '尺寸待确认', '回归-尺寸待确认', `${c.productId} ${c.sizeFitStatus}`)
    check(c.reasons.length >= 2, '回归-理由至少2条', `${c.productId}`)
    const unknown = c.usedFields.filter((f) => !(f.split('.')[0] in (catalog.find((x) => x.id === c.productId) ?? {})))
    check(unknown.length === 0 && c.usedFields.length > 0, '回归-引用真实字段', `${c.productId} ${unknown.join(',')}`)
    check(c.price <= 8000, '回归-预算上限', `${c.productId} ${c.price}`)
    if (c.price < 5000) check(c.caveats.some((x) => x.includes('低于期望区间')), '回归-低于区间标记', `${c.productId}`)
  }
  const inRange = cards.filter((c) => c.price >= 5000)
  const below = cards.filter((c) => c.price < 5000)
  if (inRange.length > 0) {
    const maxIn = Math.max(...inRange.map((c) => budgetSub(c)?.score ?? 0))
    const maxBelow = below.length > 0 ? Math.max(...below.map((c) => budgetSub(c)?.score ?? 0)) : -1
    check(maxIn > maxBelow, '回归-区间内预算分高于低于区间款', `${maxIn} vs ${maxBelow}`)
  }
}

console.log('========== 预算语义测试报告 ==========')
console.log(`断言: ${checked - failures.length}/${checked} 通过`)
if (failures.length > 0) {
  console.error('失败明细:')
  for (const f of failures) console.error('  [FAIL] ' + f)
  process.exit(1)
}
console.log('全部通过 ✓')
process.exit(0)
