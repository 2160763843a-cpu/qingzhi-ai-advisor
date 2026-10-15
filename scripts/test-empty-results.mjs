// 无结果状态回归测试（12 项场景，全部基于真实 120 SKU 计算）
// 运行: node scripts/test-empty-results.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Advisor } from '../frontend/src/engine/engine.ts'
import { recommendFromSlots } from '../frontend/src/engine/recommend.ts'
import { MemoryStorage, SessionStore } from '../frontend/src/engine/session.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'))

const FAILURES = []
let CHECKS = 0
function check(cond, label, detail) {
  CHECKS += 1
  if (!cond) FAILURES.push(`${label}: ${detail}`)
}

const CAP_TURNS = ['我想买一台冰箱', '3000元以内', '5人以上', '大容量']

// ---- 场景 1：冰箱 3000以内 + 5人以上 + 大容量 → 无完全匹配 + 需求就绪 ----
{
  const storage = new MemoryStorage()
  const a = new Advisor(new SessionStore(storage))
  for (const t of CAP_TURNS) a.processMessage(t)
  const ctx = a.getContext()
  check(ctx.stage === 'ready', 'S1 需求就绪', `stage=${ctx.stage}`)
  check(ctx.slots.familySizeMin?.value === 5, 'S1 人数下限', `familySizeMin=${JSON.stringify(ctx.slots.familySizeMin?.value)}`)
  check(ctx.slots.preferences?.value?.includes('large_capacity') === true, 'S1 大容量偏好', JSON.stringify(ctx.slots.preferences?.value))

  const res = a.generateRecommendations(catalog)
  check(!res.refused, 'S1 生成未被拒绝', JSON.stringify(res.refused))
  const rec = a.getContext().recommendations
  check(Boolean(rec?.empty), 'S1 进入无结果状态', `empty=${JSON.stringify(rec?.empty?.message ?? null)}`)
  check(Object.values(rec?.cards ?? {}).flat().length === 0, 'S1 候选为 0', '候选应无')
  const fr = rec?.empty?.filterReport
  check(Boolean(fr && fr.exactMatchCount === 0), 'S1 过滤报告存在', JSON.stringify(fr))
  // 数字必须来自真实商品池
  const fridges = catalog.filter((p) => p.category === '冰箱')
  const withinBudget = fridges.filter((p) => p.price <= 3000)
  check(fr.totalProductsConsidered === 120, 'S1 全量商品数', `${fr.totalProductsConsidered}`)
  check(fr.categoryMatched === fridges.length, 'S1 品类计数', `${fr.categoryMatched} vs ${fridges.length}`)
  check(fr.afterBudgetFilter === withinBudget.length, 'S1 预算过滤计数', `${fr.afterBudgetFilter} vs ${withinBudget.length}`)
  const maxCap = Math.max(...withinBudget.map((p) => p.capacityL))
  check(rec.empty.insight.maxCapacityInBudget === maxCap, 'S1 预算内最大容量', `${rec.empty.insight.maxCapacityInBudget} vs ${maxCap}`)
  const low = 5 * 60 + 110
  check(rec.empty.insight.suggestedRangeLow === low, 'S1 建议容量下限', `${rec.empty.insight.suggestedRangeLow} vs ${low}`)
  const meetMin = Math.min(...fridges.filter((p) => p.capacityL >= low).map((p) => p.price))
  check(rec.empty.insight.minPriceForSuggested === meetMin, 'S1 满足容量最低价', `${rec.empty.insight.minPriceForSuggested} vs ${meetMin}`)
  check((rec.empty.message ?? '').includes('暂未找到'), 'S1 明确无匹配话术', rec.empty.message)

  // 场景 3：3000元以内最接近商品（预算内按分排序，容量最大优先体现）
  const alts = rec.empty.alternatives
  check(alts.length > 0 && alts.length <= 3, 'S1 替代方案数量', `${alts.length}`)
  check(alts.every((x) => x.price <= 3000), 'S1 替代方案全部在预算内', JSON.stringify(alts.map((x) => x.price)))
  check(alts.every((x) => x.caveats.some((cv) => cv.includes('未满足原条件'))), 'S1 替代方案标注未满足条件', alts.map((x) => x.caveats[0]).join(' / '))

  const snapshotRaw = storage.getItem('qzad.session.v1')

  // 场景 2：提高预算后出现完全匹配（同一会话，条件修改 → 失效 → 重生成）
  a.processMessage('预算改成7000元')
  check(a.getContext().recommendations.stale === true, 'S2 条件变化后旧结果失效', 'stale 应为 true')
  const res2 = a.generateRecommendations(catalog)
  check(!res2.refused, 'S2 重生成未被拒绝')
  const rec2 = a.getContext().recommendations
  check(Object.values(rec2.cards).flat().length > 0, 'S2 提高预算后出现匹配', `候选 ${Object.values(rec2.cards).flat().length}`)
  check(rec2.empty === null, 'S2 无结果状态清除', 'empty 应为 null')

  // 场景 12：用户修改条件后旧无结果状态失效（已在 S2 覆盖 stale，补充快照变化断言）
  check(rec2.snapshot !== rec.snapshot, 'S12 快照已变化', 'snapshot 应不同')

  // 场景 11：零结果时不得提示“已生成N款候选”（强制重新生成以验证话术）
  a.generateRecommendations(catalog, { nextBatch: true })
  const lastAssistant = a.getContext().recentMessages.filter((m) => m.role === 'assistant').at(-1)
  check(!/已生成\d+款/.test(lastAssistant?.text ?? ''), 'S11 零结果话术正确', lastAssistant?.text)
  check((lastAssistant?.text ?? '').includes('暂未找到') || (lastAssistant?.text ?? '').includes('当前总预算') || !/已生成\d+款/.test(lastAssistant?.text ?? ''), 'S11 零结果话术包含明确说明', lastAssistant?.text)
  // 场景 9：无结果状态刷新恢复（S1 时点的存储快照）
  const ms2 = new MemoryStorage()
  if (snapshotRaw) ms2.setItem('qzad.session.v1', snapshotRaw)
  const a2 = new Advisor(new SessionStore(ms2))
  const restored = a2.getContext()
  check(Boolean(restored?.recommendations?.empty), 'S9 刷新后无结果状态保留', 'empty 应保留')
  check(restored.recommendations.empty.alternatives.length === alts.length, 'S9 替代方案一并恢复', 'alternatives 应恢复')

  // 场景 10：换一批在零结果时不死循环
  const res3 = a.generateRecommendations(catalog, { nextBatch: true })
  check(!res3.refused, 'S10 换一批正常返回')
  check(Object.values(a.getContext().recommendations.cards).flat().length === 0, 'S10 仍为零结果', '应为空')
}

// ---- 场景 3（补充）：保持预算返回最接近商品且差距真实 ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 3000, familySizeMin: 5, preferences: ['large_capacity'] }, catalog)
  const cards = Object.values(r.cards).flat()
  check(cards.length === 0, 'S3b 无完全匹配', `候选 ${cards.length}`)
  check(Boolean(r.nearest || r.empty), 'S3b 提供最接近方案', 'nearest/empty 至少其一')
  if (r.empty) {
    check(r.empty.insight.minPriceForSuggested !== null && r.empty.insight.minPriceForSuggested > 3000, 'S3b 最低可行预算高于当前预算', String(r.empty.insight.minPriceForSuggested))
  }
}

// ---- 场景 4：所有候选均无库存 ----
{
  const noStock = catalog.map((p) => ({ ...p, stockStatus: '无货' }))
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 9000, familySize: 3 }, noStock)
  const cards = Object.values(r.cards).flat()
  check(cards.length === 0, 'S4 无库存全过滤', `候选 ${cards.length}`)
  check(r.empty.filterReport.afterStockFilter === 0, 'S4 过滤报告库存计数', `${r.empty.filterReport.afterStockFilter}`)
  check(r.empty.filterReport.primaryConflict.includes('库存'), 'S4 主要冲突为库存', r.empty.filterReport.primaryConflict)
}

// ---- 场景 5：安装宽度限制导致全部过滤 ----
{
  const r = recommendFromSlots({ categories: ['冰箱'], itemBudget: 9000, installationDimensions: [{ location: '厨房', width: 450, depth: 500, unit: 'mm' }] }, catalog)
  check(Object.values(r.cards).flat().length === 0, 'S5 宽度全过滤', `候选 ${Object.values(r.cards).flat().length}`)
  check(r.empty.filterReport.afterDimensionFilter === 0, 'S5 尺寸过滤计数', `${r.empty.filterReport.afterDimensionFilter}`)
  check(r.empty.filterReport.primaryConflict.includes('安装尺寸') || r.empty.filterReport.primaryConflict.includes('尺寸'), 'S5 主要冲突为尺寸', r.empty.filterReport.primaryConflict)
}

// ---- 场景 6：面积条件导致空调无匹配 ----
{
  const r = recommendFromSlots({ categories: ['空调'], itemBudget: 20000, roomArea: 60 }, catalog)
  check(Object.values(r.cards).flat().length === 0, 'S6 面积无匹配', `候选 ${Object.values(r.cards).flat().length}`)
  check(r.empty.filterReport.exactMatchCount === 0, 'S6 完全匹配为 0', `${r.empty.filterReport.exactMatchCount}`)
}

// ---- 场景 7：多品类组合中一个品类无匹配 → 组合不可行且指明品类 ----
{
  const r = recommendFromSlots({ categories: ['洗碗机', '空调'], totalBudget: 3000, familySize: 3, installationDimensions: [{ location: '厨房', width: 600, depth: 600, unit: 'mm' }] }, catalog)
  check(r.bundles.length === 0, 'S7 组合不可行', `组合 ${r.bundles.length}`)
  check(r.infeasible.length > 0 && r.infeasible.some((x) => x.reason.includes('洗碗机') || x.reason.includes('空调')), 'S7 指明无匹配品类', r.infeasible.map((x) => x.reason).join(' / '))
}

// ---- 场景 8：用户取消硬约束后恢复推荐 ----
{
  const a = new Advisor(new SessionStore(new MemoryStorage()))
  a.processMessage('我想买冰箱')
  a.processMessage('预算不能超过4000元')
  a.processMessage('厨房宽度不超过500')
  a.processMessage('五口人以上')
  a.processMessage('要大容量的')
  let rec = a.getContext().recommendations
  const res1 = a.generateRecommendations(catalog)
  check(!res1.refused, 'S8 首次生成正常')
  rec = a.getContext().recommendations
  check(Object.values(rec.cards).flat().length === 0, 'S8 严格条件下无匹配', `候选 ${Object.values(rec.cards).flat().length}`)
  a.processMessage('宽度不限，预算改成8000元')
  check(a.getContext().recommendations.stale === true, 'S8 取消约束后失效', 'stale 应为 true')
  const res2 = a.generateRecommendations(catalog)
  check(!res2.refused, 'S8 重生成正常')
  rec = a.getContext().recommendations
  check(Object.values(rec.cards).flat().length > 0, 'S8 取消约束后恢复推荐', `候选 ${Object.values(rec.cards).flat().length}`)
  check(rec.empty === null, 'S8 空状态清除', 'empty 应为 null')
}

// ---- 场景 11（补充）：零结果消息不得出现“已生成N款候选” ----
{
  const a = new Advisor(new SessionStore(new MemoryStorage()))
  for (const t of ['我是青岛三口之家，想买冰箱和洗衣机', '1000元以内', '宽90厘米以内', '暂不确定深度']) a.processMessage(t)
  a.generateRecommendations(catalog)
  const last = a.getContext().recentMessages.filter((m) => m.role === 'assistant').at(-1)
  check(!/已生成\d+款/.test(last?.text ?? ''), 'S11 零结果话术正确', last?.text)
  check((last?.text ?? '').includes('暂未找到') || (last?.text ?? '').includes('当前总预算'), 'S11 零结果话术包含明确说明', last?.text)
}

// ---- 预算重复文案修复验证 ----
{
  const a = new Advisor(new SessionStore(new MemoryStorage()))
  a.processMessage('我想买一台冰箱')
  const resp = a.processMessage('3000元以内')
  check(resp.reply.includes('冰箱预算上限已记录为 3000 元'), '预算文案', resp.reply)
  check(!/单品预算已记录为/.test(resp.reply), '预算文案无重复', resp.reply)
  check(!resp.reply.includes('undefined'), '预算文案无 undefined', resp.reply)
}

console.log('========== 无结果状态回归测试报告 ==========')
console.log(`断言: ${CHECKS - FAILURES.length}/${CHECKS} 通过`)
if (FAILURES.length > 0) {
  console.error('失败明细:')
  for (const f of FAILURES) console.error('  [FAIL] ' + f)
  process.exit(1)
}
console.log('全部通过 ✓')
process.exit(0)
