<template>
  <div class="compare-page">
    <h1 class="page-title">商品对比</h1>
    <p class="page-sub">最多同时对比 3 款同品类商品；数据全部来自当前 120 个模拟 SKU。</p>

    <el-card v-if="version >= 0 && store.items.length === 0" shadow="never" class="state-card">
      <h2 class="state-title">尚未选择对比商品</h2>
      <p>你可以从推荐结果或商品库把商品加入对比（最多 3 款）。</p>
      <div class="state-ops">
        <el-button type="primary" tag="router-link" to="/chat">前往智能顾问</el-button>
        <el-button tag="router-link" to="/products">前往商品库</el-button>
      </div>
    </el-card>

    <el-card v-else-if="store.items.length === 1" shadow="never" class="state-card">
      <h2 class="state-title">还需要至少选择 1 款商品</h2>
      <p>当前对比列表：{{ store.items[0].name }}。再选择 1 款同品类商品即可开始对比。</p>
      <div class="state-ops">
        <el-button type="primary" tag="router-link" to="/products">前往商品库</el-button>
        <el-button @click="removeAt(0)">移除该商品</el-button>
      </div>
    </el-card>

    <template v-else>
      <div class="toolbar">
        <span class="need-hint">{{ hasNeeds ? '按照你当前的需求进行比较' : '当前没有需求上下文，仅做客观差异总结；补充预算、人数和偏好后可给出匹配结论' }}</span>
        <el-radio-group v-model="mode" size="small" @change="onModeChange">
          <el-radio-button value="all">全部参数</el-radio-button>
          <el-radio-button value="diff">只看差异</el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="hasNeeds" class="verdict-panel">
        <h2 class="panel-title">对比结论（复用推荐引擎评分）</h2>
        <p class="verdict-line">
          在你当前条件下更匹配的是：<b>{{ best?.card.name }}</b>（匹配 {{ best?.card.totalScore }} 分{{ runnerUp ? `，次选 ${runnerUp.card.name} ${runnerUp.card.totalScore} 分` : '' }}）。
        </p>
        <ul class="verdict-list">
          <li v-if="best?.card.reasons.length">推荐依据：{{ best.card.reasons.slice(0, 3).join('；') }}</li>
          <li v-if="best?.card.caveats.length">需要接受的取舍：{{ best.card.caveats.slice(0, 2).join('；') }}</li>
          <li v-if="pendingConfirm.length">仍待确认：{{ pendingConfirm.join('；') }}</li>
          <li>如果更重视价格：{{ cheapest?.name }}（{{ cheapest?.price }} 元）</li>
          <li v-if="energyBest">如果更重视节能：{{ energyBest.name }}（能效 {{ energyBest.energyGrade }}）</li>
          <li v-if="quietBest">如果更重视静音：{{ quietBest.name }}（噪声 {{ noiseText(quietBest) }}）</li>
        </ul>
        <el-button size="small" type="primary" plain @click="goRecommend">按当前需求生成推荐方案</el-button>
      </div>

      <div class="table-scroll" role="region" aria-label="商品参数对比表">
        <p class="swipe-hint">左右滑动查看更多参数 →</p>
        <table class="cmp-table">
          <thead>
            <tr>
              <th scope="col" class="param-col">参数</th>
              <th v-for="item in store.items" :key="item.productId" scope="col">
                <div class="prod-head">
                  <div class="prod-name">{{ item.name }}</div>
                  <div class="prod-fit">
                    <span v-if="fitMarks[item.productId]" class="fit-mark" :data-level="fitMarks[item.productId]">{{ fitMarks[item.productId] }}</span>
                    <span class="fit-score">{{ scores[item.productId]?.card.totalScore ?? '—' }} 分</span>
                  </div>
                  <el-button size="small" link type="danger" @click="removeAt(store.items.indexOf(item))">从对比移除</el-button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row.key" :class="{ diff: mode === 'diff' && isDiffRow(row), same: mode === 'diff' && !isDiffRow(row) }">
              <th scope="row" class="param-col">{{ row.label }}</th>
              <td v-for="item in store.items" :key="item.productId" :class="{ risk: riskOf(item.product, row.key) }">
                <span v-if="riskOf(item.product, row.key)" class="risk-icon" aria-label="风险提醒">⚠</span>
                {{ riskOf(item.product, row.key) || row.get(item.product) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="bottom-ops">
        <el-button size="small" @click="clearAll">清空对比列表</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getAppCompareStore } from '../stores/compare'
import { commonCompareFields, compareFieldsFor, type CompareField } from '../engine/compareFields'
import { createAdvisor } from '../engine/engine'
import { slotsInputFrom } from '../engine/engine'
import { scoreForComparison } from '../engine/recommend'
import { createBrowserStore } from '../engine/session'
import { fetchProducts } from '../api/client'
import type { Product } from '../types/data'

const store = getAppCompareStore()
const router = useRouter()
const version = ref(0)
const mode = ref<'all' | 'diff'>('all')
const advisor = createAdvisor(createBrowserStore().store)

const products = computed(() => store.items.map((i) => i.product))
const category = computed(() => store.items[0]?.category ?? '')

const rows = computed<CompareField[]>(() => (category.value ? [...commonCompareFields(), ...compareFieldsFor(category.value)] : []))
const visibleRows = computed(() => (mode.value === 'diff' ? rows.value.filter((r) => isDiffRow(r)) : rows.value))

function valuesOf(row: CompareField): string[] {
  return products.value.map((p) => row.get(p))
}
function isDiffRow(row: CompareField): boolean {
  const v = valuesOf(row)
  return v.some((x) => x !== v[0])
}
function riskOf(p: Product, key: string): string | null {
  const stock = (p as Product & { stockStatus: string }).stockStatus
  if (key === 'stock' && stock !== '有货') return `${stock}（风险提醒）`
  const card = scores.value[p.id]?.card
  if (card?.sizeFitStatus === '尺寸待确认' && key === 'dims') return '尺寸待确认（风险提醒）'
  return null
}

const hasNeeds = computed(() => {
  const ctx = advisor.getContext()
  if (!ctx) return false
  const input = slotsInputFrom(ctx)
  return input.categories.length > 0 || Boolean(input.totalBudget || input.itemBudget || input.itemBudgetRange || input.totalBudgetMin) || Boolean(input.familySize || input.familySizeMin) || input.preferences.length > 0 || input.localNeeds.length > 0
})
const scores = computed<Record<string, ReturnType<typeof scoreForComparison>[number]>>(() => {
  const out: Record<string, ReturnType<typeof scoreForComparison>[number]> = {}
  if (!hasNeeds.value || products.value.length === 0) return out
  const ctx = advisor.getContext()
  if (!ctx) return out
  for (const sc of scoreForComparison(products.value, slotsInputFrom(ctx))) out[sc.productId] = sc
  return out
})
const sorted = computed(() => Object.values(scores.value).sort((a, b) => b.card.totalScore - a.card.totalScore))
const best = computed(() => sorted.value[0] ?? null)
const runnerUp = computed(() => sorted.value[1] ?? null)
const fitMarks = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  if (!hasNeeds.value) return out
  for (const sc of Object.values(scores.value)) {
    if (sc.card.sizeFitStatus === '尺寸待确认') out[sc.productId] = '待确认'
    else if (sc.productId === best.value?.productId) out[sc.productId] = '更符合'
    else if (sc.card.totalScore >= 70) out[sc.productId] = '部分符合'
    else out[sc.productId] = '不符合'
  }
  return out
})
const pendingConfirm = computed(() => {
  const list: string[] = []
  for (const sc of Object.values(scores.value)) {
    if (sc.card.sizeFitStatus === '尺寸待确认') list.push(`${sc.card.name} 的安装尺寸`)
  }
  return list
})
const cheapest = computed(() => products.value.reduce((a, b) => (b.price < a.price ? b : a), products.value[0]))
const energyBest = computed(() => {
  if (!products.value.length) return null
  const rank = (p: Product) => { const m = String(p.energyGrade).match(/([一二三四五])/); return m ? 6 - ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 } as Record<string, number>)[m[1]]! : 0 }
  return products.value.reduce((a, b) => (rank(b) > rank(a) ? b : a))
})
const quietBest = computed(() => {
  const noise = (p: Product) => { const n = p.noiseDb; return typeof n === 'number' ? n : n?.standard }
  const rated = products.value.filter((p) => noise(p) !== undefined)
  if (!rated.length) return null
  return rated.reduce((a, b) => ((noise(b) ?? 999) < (noise(a) ?? 999) ? b : a))
})
function noiseText(p: Product): string {
  const n = p.noiseDb
  return typeof n === 'number' ? `${n} dB` : `${n?.standard} dB`
}

function removeAt(index: number): void {
  const item = store.items[index]
  if (item) {
    store.removeById(item.productId, '推荐卡')
    version.value += 1
  }
}
function clearAll(): void {
  store.clear('推荐卡')
  version.value += 1
  ElMessage.success('已清空对比列表')
}
function onModeChange(): void {
  if (mode.value === 'diff') store.recordDifferenceOnly()
}
function goRecommend(): void {
  store.recordRecommendationClicked()
  router.push('/chat')
}

onMounted(async () => {
  try {
    const all = await fetchProducts()
    const removed = store.prune(all.map((x) => x.id))
    if (removed.length > 0) ElMessage.warning(`已自动移除失效的对比商品：${removed.map((r) => r.name).join('、')}`)
  } catch { /* 目录不可用时保留现状 */ }
  store.recordView()
  version.value += 1
})
</script>

<style scoped>
.compare-page { max-width: 1080px; margin: 0 auto; }
.page-title { font-size: 22px; margin: 6px 0 4px; }
.page-sub { color: #7a8a99; font-size: 13px; margin: 0 0 14px; }
.state-card { text-align: left; }
.state-title { font-size: 17px; margin: 4px 0 8px; }
.state-ops { display: flex; gap: 10px; margin-top: 10px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.need-hint { font-size: 13px; color: #0b6e6e; font-weight: 600; }
.verdict-panel { background: #f0f9f4; border: 1px solid #d6ede0; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.panel-title { font-size: 15px; margin: 0 0 6px; }
.verdict-line { margin: 0 0 6px; }
.verdict-list { margin: 0 0 10px; padding-left: 18px; font-size: 13px; color: #33475b; line-height: 1.7; }
.table-scroll { overflow-x: auto; border: 1px solid #e6ebf0; border-radius: 8px; background: #fff; }
.swipe-hint { display: none; margin: 8px 12px 0; color: #7a8a99; font-size: 12px; }
.cmp-table { border-collapse: collapse; width: 100%; min-width: 640px; font-size: 13px; }
.cmp-table th, .cmp-table td { border-bottom: 1px solid #eef2f6; padding: 9px 12px; text-align: left; vertical-align: top; line-height: 1.6; }
.cmp-table thead th { background: #f7fafc; }
.param-col { width: 130px; color: #5b6b7b; white-space: nowrap; font-weight: 600; background: #fbfdfe; }
tr.diff td, tr.diff th { background: #fff8e6; }
tr.same td, tr.same th { color: #9aa8b5; }
td.risk { color: #a15c00; font-weight: 600; }
.risk-icon { margin-right: 4px; }
.prod-head { display: flex; flex-direction: column; gap: 4px; }
.prod-name { font-weight: 700; color: #1f2d3d; }
.prod-fit { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.fit-mark[data-level='更符合'] { color: #12814b; font-weight: 700; }
.fit-mark[data-level='部分符合'] { color: #8a5a00; font-weight: 600; }
.fit-mark[data-level='不符合'] { color: #a33; font-weight: 600; }
.fit-mark[data-level='待确认'] { color: #5b6b7b; }
.fit-score { color: #7a8a99; }
.bottom-ops { margin-top: 12px; }
@media (max-width: 768px) {
  .swipe-hint { display: block; }
  .param-col { position: sticky; left: 0; z-index: 1; }
}
</style>
