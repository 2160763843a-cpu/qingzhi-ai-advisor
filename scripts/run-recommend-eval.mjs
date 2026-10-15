// 推荐评测运行器：48组业务案例（验收标准为人工业务规则，与引擎输出相互独立）
// 命中定义：一个案例的全部机器可验证验收项（品类匹配/严格预算/硬性尺寸/Top3含可接受商品/
// 无解时正确拒绝/理由引用真实字段/权重和为100）全部通过才算命中。
// 运行: node scripts/run-recommend-eval.mjs（目标总体命中率 >= 75%）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recommendFromSlots } from '../frontend/src/engine/recommend.ts'
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore, MemoryStorage } from '../frontend/src/engine/session.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'))
const cases = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'recommend-eval.json'), 'utf8'))

const UNIT_TO_MM = { mm: 1, 毫米: 1, cm: 10, 公分: 10, 厘米: 10, m: 1000, 米: 1000 }

function matchFilters(p, f) {
  if (f.category && p.category !== f.category) return false
  if (f.priceMax !== undefined && p.price > f.priceMax) return false
  if (f.priceMin !== undefined && p.price < f.priceMin) return false
  if (f.maxWidthMm !== undefined && p.dimensionsMm.width > f.maxWidthMm) return false
  if (f.maxDepthMm !== undefined && p.dimensionsMm.depth > f.maxDepthMm) return false
  if (f.minCapacityL !== undefined && !(p.capacityL >= f.minCapacityL)) return false
  if (f.maxCapacityL !== undefined && !(p.capacityL <= f.maxCapacityL)) return false
  if (f.minFreezerL !== undefined && !(p.freezerCapacityL >= f.minFreezerL)) return false
  if (f.maxNoise !== undefined && !(p.noiseDb.standard <= f.maxNoise)) return false
  if (f.minWashKg !== undefined && !(p.washCapacityKg >= f.minWashKg)) return false
  if (f.minSets !== undefined && !(p.placeSets >= f.minSets)) return false
  if (f.minLiterL !== undefined && !(p.literL >= f.minLiterL)) return false
  if (f.heatType !== undefined && p.heatType !== f.heatType) return false
  if (f.heatTypeContains !== undefined && !String(p.heatType).includes(f.heatTypeContains)) return false
  if (f.energyIn !== undefined && !f.energyIn.includes(p.energyGrade)) return false
  if (f.inchMin !== undefined && !(p.inchSize >= f.inchMin)) return false
  if (f.inchMax !== undefined && !(p.inchSize <= f.inchMax)) return false
  if (f.resolution !== undefined && p.resolution !== f.resolution) return false
  if (f.areaCovers !== undefined) {
    if (!p.suitableArea) return false
    const [lo, hi] = p.suitableArea
    if (f.areaCovers < lo || f.areaCovers > hi) return false
  }
  return true
}

function itemDimsOk(p, slots, itemMaxWidthMm, cat) {
  const locs = { 冰箱: ['厨房'], 洗衣机: ['阳台'], 洗碗机: ['厨房', '阳台'], 空调: ['客厅', '卧室'], 电视: ['客厅'], 热水器: ['卫生间', '阳台', '厨房'] }
  const dim = (slots.installationDimensions ?? []).find((d) => d.location && (locs[cat] ?? []).includes(d.location))
  const factor = dim ? (UNIT_TO_MM[dim.unit] ?? 1) : 1
  if (dim && dim.width !== undefined && p.dimensionsMm.width > dim.width * factor) return false
  if (dim && dim.depth !== undefined && p.dimensionsMm.depth > dim.depth * factor) return false
  const cap = itemMaxWidthMm?.[cat]
  if (cap !== undefined && p.dimensionsMm.width > cap) return false
  return true
}

const FAILURES = []
let hardViolations = 0
let CHECKS = 0

function check(cond, label, detail) {
  CHECKS += 1
  if (!cond) fail(`${label} — ${detail}`)
}
const budgetSub = (card) => card.subScores.find((x) => x.key === 'budget')
let budgetViolations = 0
let totalTime = 0
let maxTime = 0
const perClass = {}
const summaryLines = []

function runCase(c) {
  const checks = []
  const fail = (msg) => checks.push(msg)

  if (c.type === 'single') {
    const r = recommendFromSlots(c.slots, catalog)
    totalTime += r.elapsedMs
    maxTime = Math.max(maxTime, r.elapsedMs)
    const cards = Object.values(r.cards).flat()
    const acceptable = catalog.filter((p) => matchFilters(p, c.accept.filters ?? {}))
    const expectNo = Boolean(c.accept.expectNoResult)

    for (const card of cards) {
      if (card.category !== c.category) {
        hardViolations += 1
        fail(`硬约束违规：返回了非 ${c.category} 品类商品 ${card.productId}`)
      }
      const dim = (c.slots.installationDimensions ?? []).find((d) => d.location && ({ 冰箱: ['厨房'], 洗衣机: ['阳台'], 洗碗机: ['厨房', '阳台'], 空调: ['客厅', '卧室'], 电视: ['客厅'], 热水器: ['卫生间', '阳台', '厨房'] }[c.category] ?? []).includes(d.location))
      const factor = dim ? (UNIT_TO_MM[dim.unit] ?? 1) : 1
      const prod = catalog.find((x) => x.id === card.productId)
      if (dim && dim.width !== undefined && prod.dimensionsMm.width > dim.width * factor) {
        hardViolations += 1
        fail(`硬约束违规：${card.productId} 宽度超限`)
      }
      if (dim && dim.depth !== undefined && prod.dimensionsMm.depth > dim.depth * factor) {
        hardViolations += 1
        fail(`硬约束违规：${card.productId} 深度超限`)
      }
      if (c.accept.strictBudget !== undefined && prod.price > c.accept.strictBudget) {
        budgetViolations += 1
        fail(`预算违规：${card.productId} 价格 ${prod.price} 超出严格预算 ${c.accept.strictBudget}`)
      }
      if (c.accept.top1PriceMax !== undefined && cards[0] && prod.id === cards[0].productId && prod.price > c.accept.top1PriceMax) {
        fail(`Top1 价格 ${prod.price} 超出性价比预期上限 ${c.accept.top1PriceMax}`)
      }
      const wSum = card.subScores.reduce((a, b) => a + b.weight, 0)
      if (wSum !== 100) fail(`权重和为 ${wSum}，应为 100（${card.productId}）`)
      if (c.accept.requireReasons) {
        if (card.reasons.length < 2) fail(`${card.productId} 推荐理由少于 2 条`)
        const unknown = card.usedFields.filter((f) => !(f.split('.')[0] in prod))
        if (card.usedFields.length === 0 || unknown.length > 0) fail(`${card.productId} 引用了不存在的字段: ${unknown.join(',')}`)
      }
      if (c.accept.allSizePending) {
        check(cards.every((card) => card.sizeFitStatus === '尺寸待确认'), '未提供尺寸时应全部标记尺寸待确认', JSON.stringify(cards.map((x) => x.sizeFitStatus)))
      }
      if (c.accept.rangeRespect) {
        const { min, max } = c.accept.rangeRespect
        for (const card of cards) {
          const bs = budgetSub(card)
          if (card.price > max) fail(`${card.productId} 价格 ${card.price} 超出区间上限 ${max}`)
          if (card.price < min) {
            check((bs?.score ?? 100) < 100, `${card.productId} 低于期望区间不得满分`)
            check(card.caveats.some((x) => x.includes('低于期望区间')), `${card.productId} 低于区间必须标记（实际: ${card.caveats.join('|')}）`)
          }
        }
        const inRange = cards.filter((card) => card.price >= min)
        const below = cards.filter((card) => card.price < min)
        if (inRange.length > 0 && below.length > 0) {
          const maxIn = Math.max(...inRange.map((card) => budgetSub(card)?.score ?? 0))
          const maxBelow = Math.max(...below.map((card) => budgetSub(card)?.score ?? 0))
          check(maxIn > maxBelow, `区间内预算分(${maxIn})应高于低于区间款(${maxBelow})`)
        }
      }
      if (c.accept.minBudgetFloor !== undefined) {
        for (const card of cards) {
          if (card.price < c.accept.minBudgetFloor) {
            hardViolations += 1
            fail(`预算违规：${card.productId} 价格 ${card.price} 低于至少要求 ${c.accept.minBudgetFloor}`)
          }
        }
      }
      if (c.accept.prefDimMin) {
        const sub = card.subScores.find((x) => x.key === c.accept.prefDimMin.dim)
        if (!sub || sub.score < c.accept.prefDimMin.min) fail(`${card.productId} 未体现关键偏好（${c.accept.prefDimMin.dim}=${sub?.score}）`)
      }
    }

    if (expectNo) {
      if (cards.length > 0) fail(`应正确拒绝（无完全匹配），但返回了 ${cards.length} 款`)
      if (c.accept.requireNearest && !r.nearest) fail('应展示最接近方案及差距')
    } else {
      if (cards.length === 0) fail('无结果，但该案例存在可接受商品')
      else {
        const anyAccept = cards.some((card) => acceptable.some((p) => p.id === card.productId))
        if (!anyAccept) fail(`Top3 未命中可接受商品（可接受集合 ${acceptable.length} 款: ${acceptable.slice(0, 4).map((p) => p.id).join(',')}...）`)
      }
    }
    perClass[c.category] = perClass[c.category] || { hit: 0, total: 0 }
    return { pass: checks.length === 0, checks, cards: cards.length }
  }

  // 组合案例
  if (c.accept.expectAskDims) {
    const advisor = new Advisor(new SessionStore(new MemoryStorage()))
    for (const [k, v] of Object.entries(c.slots)) {
      void k
      void v
    }
    advisor.processMessage('我想买冰箱和洗衣机')
    advisor.processMessage(`总预算${c.slots.totalBudget}元`)
    const res = advisor.generateRecommendations(catalog)
    if (!res.refused || res.refused.code !== 'dims_pending') {
      fail('宽度缺失时应追问尺寸（dims_pending），实际未拒绝')
    }
    perClass['组合'] = perClass['组合'] || { hit: 0, total: 0 }
    return { pass: checks.length === 0, checks, bundles: 0 }
  }

  const r = recommendFromSlots(c.slots, catalog)
  totalTime += r.elapsedMs
  maxTime = Math.max(maxTime, r.elapsedMs)

  if (c.accept.expectInfeasible) {
    if (r.bundles.length > 0) fail(`应判定无解，实际返回 ${r.bundles.length} 套组合`)
    if (r.bundles.length === 0 && r.infeasible.length === 0) fail('无解时应输出不可行原因')
  } else if (c.accept.feasibleMin !== undefined) {
    if (r.bundles.length < c.accept.feasibleMin) fail(`可行组合应 ≥ ${c.accept.feasibleMin} 套，实际 ${r.bundles.length} 套${r.infeasible.length ? '；不可行: ' + r.infeasible.map((x) => x.reason).join(' / ') : ''}`)
    for (const b of r.bundles) {
      const cats = Array.from(new Set(b.items.map((x) => x.category)))
      if (c.accept.categoriesExact && JSON.stringify(cats.slice().sort()) !== JSON.stringify(c.accept.categoriesExact.slice().sort())) {
        hardViolations += 1
        fail(`组合品类不符：${cats.join('+')}`)
      }
      if (c.accept.strictTotal !== undefined && b.totalPrice > c.accept.strictTotal) {
        budgetViolations += 1
        fail(`预算违规：组合总价 ${b.totalPrice} 超出严格总预算 ${c.accept.strictTotal}`)
      }
      if (c.accept.maxTotal !== undefined && b.totalPrice > c.accept.maxTotal) fail(`组合总价 ${b.totalPrice} 超出上浮上限 ${c.accept.maxTotal}`)
      for (const item of b.items) {
        const prod = catalog.find((x) => x.id === item.productId)
        if (!itemDimsOk(prod, c.slots, c.accept.itemMaxWidthMm, item.category)) {
          hardViolations += 1
          fail(`硬约束违规：组合中 ${item.productId} 尺寸超限`)
        }
        if (c.accept.strictTotal !== undefined && prod.price > c.accept.strictTotal) {
          budgetViolations += 1
        }
        const wSum = item.subScores.reduce((a, b2) => a + b2.weight, 0)
        if (wSum !== 100) fail(`组合单品 ${item.productId} 权重和为 ${wSum}`)
        if (c.accept.requireReasons && item.reasons.length < 2) fail(`组合单品 ${item.productId} 理由少于 2 条`)
      }
      if (c.accept.prefFreezerMin) {
        const fridge = b.items.find((x) => x.category === '冰箱')
        const prod = fridge ? catalog.find((x) => x.id === fridge.productId) : null
        if (!prod || prod.freezerCapacityL < c.accept.prefFreezerMin) fail(`组合未体现海鲜冷冻需求（冷冻室应 ≥ ${c.accept.prefFreezerMin}L）`)
      }
    }
    if (c.accept.strategyPresent && !r.bundles.some((b) => b.name.includes(c.accept.strategyPresent))) {
      fail(`缺少「${c.accept.strategyPresent}」方案`)
    }
    if (c.accept.valueCheapest) {
      const value = r.bundles.find((b) => b.strategy === 'value')
      const balanced = r.bundles.find((b) => b.strategy === 'balanced')
      if (!value || !balanced || value.totalPrice > balanced.totalPrice) fail('性价比组合总价应不高于均衡组合')
    }
  }
  perClass['组合'] = perClass['组合'] || { hit: 0, total: 0 }
  return { pass: checks.length === 0, checks, bundles: r.bundles.length }
}

let hits = 0
const bundleResults = []
const detail = []
for (const c of cases) {
  const r = runCase(c)
  const cls = c.type === 'bundle' ? '组合' : c.category
  perClass[cls].total += 1
  if (r.pass) {
    hits += 1
    perClass[cls].hit += 1
  } else {
    FAILURES.push({ id: c.id, title: c.title, difficulty: c.difficulty, checks: r.checks })
  }
  if (c.type === 'bundle') bundleResults.push({ id: c.id, feasible: r.bundles })
  detail.push(`${r.pass ? 'PASS' : 'FAIL'} ${c.id} [${c.difficulty}] ${c.title}`)
}

const total = cases.length
const rate = Math.round((hits / total) * 1000) / 10
console.log('========== 推荐评测报告（模拟测试集，验收标准独立于引擎输出） ==========')
console.log(`案例: ${total} | 命中: ${hits} | 总体命中率: ${rate}% (目标 >= 75%)`)
console.log(`硬约束违规: ${hardViolations} 次 | 预算违规: ${budgetViolations} 次`)
console.log(`平均耗时: ${Math.round((totalTime / total) * 100) / 100}ms | 最慢耗时: ${maxTime}ms`)
console.log('\n分类命中率:')
for (const [cls, v] of Object.entries(perClass)) {
  console.log(`  ${cls}: ${v.total === 0 ? 'n/a' : `${v.hit}/${v.total} (${Math.round((v.hit / v.total) * 1000) / 10}%)`}`)
}
const bd01 = bundleResults.find((b) => b.id === 'REC-BD-01')
if (bd01) console.log(`\n主演示场景（REC-BD-01）可行组合数: ${bd01.feasible}`)
console.log('\n逐案例结果:')
for (const line of detail) console.log('  ' + line)
if (FAILURES.length > 0) {
  console.error(`\n失败案例 (${FAILURES.length}):`)
  for (const f of FAILURES) {
    console.error(`  [${f.id}] ${f.title}`)
    for (const msg of f.checks) console.error(`     - ${msg}`)
  }
}
process.exit(rate >= 75 ? 0 : 1)
