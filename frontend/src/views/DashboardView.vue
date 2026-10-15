<template>
  <div class="dash-page">
    <div class="dash-head">
      <div>
        <h1 class="page-title">运营数据看板</h1>
        <p class="page-sub">数据来自本地演示事件，全部标注数据来源；示例数据仅用于展示图表形态，不代表真实经营结果。</p>
      </div>
      <div class="head-ops">
        <el-button size="small" @click="calOpen = true">指标口径</el-button>
        <el-button size="small" @click="exportMetrics">导出指标 JSON</el-button>
        <el-button v-if="sampleCount > 0" size="small" type="warning" plain @click="clearSample">清除示例数据</el-button>
        <el-button size="small" type="danger" plain @click="clearEvents">清除分析事件</el-button>
      </div>
    </div>

    <el-card v-if="role !== 'operator'" shadow="never" class="gate">
      <h2 class="panel-title">运营数据仅对“运营人员演示”角色开放</h2>
      <p class="hint">当前为消费者演示身份。请在页头切换为“运营人员演示”后查看完整看板；此处不会展示其他会话的任何统计。</p>
    </el-card>

    <template v-else>
      <el-card shadow="never" class="filter-bar">
        <div class="filters">
          <el-radio-group v-model="days" size="small">
            <el-radio-button value="today">今天</el-radio-button>
            <el-radio-button value="7d">近7天</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
          <template v-if="days === 'custom'">
            <el-date-picker v-model="fromDate" type="date" size="small" placeholder="开始日期" style="width: 140px" />
            <el-date-picker v-model="toDate" type="date" size="small" placeholder="结束日期" style="width: 140px" />
          </template>
          <el-radio-group v-model="origin" size="small">
            <el-radio-button value="all">全部来源</el-radio-button>
            <el-radio-button value="actual">仅实际演示数据</el-radio-button>
            <el-radio-button value="sample">仅示例数据</el-radio-button>
          </el-radio-group>
          <span class="src-line">数据来源：{{ originText }} ｜ 事件数：{{ filtered.length }} ｜ 最后更新：{{ lastUpdated }}</span>
        </div>
      </el-card>

      <el-card v-if="sampleBanner" shadow="never" class="sample-banner">示例数据视图：以下图表由固定种子生成的 7 天示例数据渲染，仅用于展示指标口径与图表形态，不代表真实经营成果。</el-card>
      <el-card v-if="emptyState" shadow="never" class="gate">
        <h2 class="panel-title">{{ emptyMsg }}</h2>
        <div class="head-ops">
          <el-button v-if="origin !== 'sample'" type="primary" size="small" tag="router-link" to="/chat">开始体验</el-button>
          <el-button v-if="showLoadSample" size="small" @click="loadSample">加载 7 天示例数据</el-button>
        </div>
      </el-card>

      <div v-if="!emptyState" class="kpi-row">
        <div class="kpi"><b>{{ m.effectiveSessions }}</b><span>有效会话</span></div>
        <div class="kpi"><b>{{ pct(m.recTriggerRate) }}</b><span>推荐触发率</span></div>
        <div class="kpi"><b>{{ pct(m.compareUsageRate) }}</b><span>对比使用率</span></div>
        <div class="kpi"><b>{{ m.highIntent }}</b><span>高意向线索</span></div>
        <div class="kpi"><b>{{ pct(m.consultToRecRate) }}</b><span>咨询→推荐</span></div>
        <div class="kpi"><b>{{ m.avgResponseMs === null ? '暂无数据' : m.avgResponseMs + 'ms' }}</b><span>平均响应（P95 {{ m.p95ResponseMs === null ? '暂无' : m.p95ResponseMs + 'ms' }}）</span></div>
      </div>

      <div v-if="!emptyState" class="grid2">
        <el-card shadow="never">
          <h2 class="panel-title">转化漏斗（去重会话数；已转化=模拟状态）</h2>
          <div v-for="f in m.funnel" :key="f.key" class="funnel-row">
            <span class="f-label">{{ f.label }}</span>
            <div class="f-bar-wrap"><div class="f-bar" :style="{ width: barW(f.sessions, m.funnel[0].sessions) }" /></div>
            <span class="f-num">{{ f.sessions }}<i v-if="f.stepRate !== null"> ｜ 环节转化 {{ f.stepRate }}%</i></span>
          </div>
          <p v-if="m.funnel.some((f, i) => i > 0 && f.sessions > m.funnel[i - 1].sessions)" class="quality">数据质量提示：存在后层会话数大于前层的链路（如先对比后咨询），已按会话独立统计，未修改原始事件。</p>
        </el-card>
        <el-card shadow="never">
          <h2 class="panel-title">意图分布（会话主意图，单位：会话）</h2>
          <p v-if="Object.keys(m.intentDist).length === 0" class="hint">暂无数据</p>
          <div v-for="(v, k) in m.intentDist" :key="k" class="funnel-row">
            <span class="f-label">{{ intentLabel(String(k)) }}</span>
            <div class="f-bar-wrap"><div class="f-bar teal" :style="{ width: barW(v, maxIntent) }" /></div>
            <span class="f-num">{{ v }}</span>
          </div>
        </el-card>
        <el-card shadow="never">
          <h2 class="panel-title">热门品类（推荐展示次数，单位：次）</h2>
          <p v-if="m.topCategories.length === 0" class="hint">暂无数据</p>
          <div v-for="c in m.topCategories" :key="c.category" class="funnel-row">
            <span class="f-label">{{ c.category }}</span>
            <div class="f-bar-wrap"><div class="f-bar green" :style="{ width: barW(c.count, m.topCategories[0].count) }" /></div>
            <span class="f-num">{{ c.count }}</span>
          </div>
        </el-card>
        <el-card shadow="never">
          <h2 class="panel-title">近7日趋势（单位：会话数）</h2>
          <table class="trend-table">
            <thead><tr><th>日期</th><th>会话</th><th>推荐</th><th>对比</th><th>线索</th></tr></thead>
            <tbody>
              <tr v-for="t in m.trend7d" :key="t.day"><td>{{ t.day }}</td><td>{{ t.sessions }}</td><td>{{ t.rec }}</td><td>{{ t.compare }}</td><td>{{ t.leads }}</td></tr>
            </tbody>
          </table>
        </el-card>
        <el-card shadow="never">
          <h2 class="panel-title">售后与投诉概览（不进入购买漏斗）</h2>
          <p class="kv">售后记录：{{ m.afterSales.total }} ｜ 未解决反馈：{{ m.afterSales.unresolved }} ｜ 高服务优先级：{{ m.afterSales.highPriority }}</p>
          <p class="kv">投诉记录：{{ m.complaints.total }}</p>
          <p class="kv">FAQ 解决率：{{ pct(m.faqResolveRate) }}</p>
        </el-card>
        <el-card shadow="never">
          <h2 class="panel-title">推荐质量与数据质量</h2>
          <p class="kv">推荐请求：{{ m.recReq }} ｜ 有结果：{{ m.recShownCount }} ｜ 无结果：{{ m.recNo }} ｜ 调整后恢复：{{ m.recAdjusted }}</p>
          <p class="kv">数据质量：缺失会话 {{ m.quality.missingSession }} ｜ 链路缺失层 {{ m.incompleteChain }} ｜ 重复事件 {{ m.quality.duplicates }} ｜ 异常事件 {{ m.quality.unclassified }}</p>
          <p class="kv">辅助事件（合法记录，不参与购买漏斗）：{{ m.auxEvents }}</p>
          <p class="hint">异常事件仅指未知类型或结构损坏事件；辅助事件（页面消息、对比浏览等）为合法记录。意图识别准确率/推荐命中率/潜客识别率来自模拟测试集（见“指标口径”），与本地演示事件分开统计。</p>
        </el-card>
      </div>
    </template>

    <el-drawer v-model="calOpen" title="指标口径（统一说明）" size="420px">
      <ul class="cal-list">
        <li v-for="c in CALIBERS" :key="c.name"><b>{{ c.name }}</b>：{{ c.def }}<br /><span class="hint">分子：{{ c.num }} ｜ 分母：{{ c.den }} ｜ 去重：{{ c.dedup }}</span></li>
      </ul>
      <p class="hint">意图识别准确率、推荐命中率、潜客线索识别率来自模拟测试集；漏斗与各转化率来自浏览器本地实际/示例事件。两类数据不混合表述。时区：Asia/Shanghai（本机本地时间）。</p>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAppAnalyticsStore, computeMetrics, generateSampleEvents, filteredEvents, type AnalyticsEvent, type Filters } from '../stores/analytics'
import { getAppLeadsStore } from '../stores/leads'
import { useRoleStore } from '../stores/role'
import { ORIGIN } from '../labels/businessLabels'
const roleStore = useRoleStore()

const store = getAppAnalyticsStore()
const leadsStore = getAppLeadsStore()
const role = computed(() => roleStore.state.current)
console.log('[DBG setup]', roleStore.state.current, JSON.stringify(roleStore.state))
const version = ref(0)
const props = withDefaults(defineProps<{ initialOrigin?: 'all' | 'actual' | 'sample'; initialDays?: 'today' | '7d' | 'all' | 'custom'; initialFrom?: string; initialTo?: string }>(), { initialOrigin: 'all', initialDays: '7d', initialFrom: '', initialTo: '' })
const days = ref<'today' | '7d' | 'all' | 'custom'>(props.initialDays)
const origin = ref<'all' | 'actual' | 'sample'>(props.initialOrigin)
const fromDate = ref(props.initialFrom)
const toDate = ref(props.initialTo)
const calOpen = ref(false)

const filters = computed<Filters>(() => ({ days: days.value, from: fromDate.value, to: toDate.value, origin: origin.value }))
const filtered = computed<AnalyticsEvent[]>(() => { void version.value; return filteredEvents(store.events, filters.value) })
const m = computed(() => {
  const metrics = computeMetrics(filtered.value)
  return { ...metrics, recReq: filtered.value.filter((e) => e.type === 'recommendation_requested').length, recShownCount: filtered.value.filter((e) => e.type === 'recommendation_shown').length, recNo: filtered.value.filter((e) => e.type === 'recommendation_no_match').length, recAdjusted: filtered.value.filter((e) => e.type === 'recommendation_adjusted').length }
})
const sampleCount = computed(() => { void version.value; return store.events.filter((e) => e.dataOrigin === 'sample').length })
const emptyState = computed(() => filtered.value.length === 0)
const emptyMsg = computed(() => {
  if (!emptyState.value) return ''
  if (origin.value === 'actual' || (origin.value === 'all' && sampleCount.value === 0)) return '当前筛选范围内暂无实际演示数据。完成一次咨询、推荐、对比或线索操作后，此处会自动更新。'
  if (origin.value === 'sample') return '当前筛选范围内暂无示例数据。可点击“加载 7 天示例数据”查看图表形态。'
  return '当前筛选范围内没有任何事件。可开始体验，或加载示例数据。'
})
const showLoadSample = computed(() => origin.value !== 'actual' && (emptyState.value || sampleCount.value === 0))
const sampleBanner = computed(() => origin.value !== 'actual' && sampleCount.value > 0 && !emptyState.value)
const lastUpdated = computed(() => { void version.value; const evs = filtered.value; const t = evs.length ? evs.slice().sort((a, b) => a.at < b.at ? -1 : 1)[evs.length - 1].at : ''; return t ? t.slice(0, 16).replace('T', ' ') : '—' })
const maxIntent = computed(() => Math.max(1, ...Object.values(m.value.intentDist)))
const originText = computed(() => origin.value === 'all' ? (sampleCount.value > 0 ? '混合视图（实际 + 示例）' : '实际演示数据') : `${ORIGIN[origin.value]}（${origin.value === 'sample' ? '示例' : '实际'}）`)

function pct(v: number | null): string { return v === null ? '暂无数据' : `${v}%` }
function barW(v: number, max: number): string { return `${Math.max(2, Math.round((v / Math.max(1, max)) * 100))}%` }
function intentLabel(k: string): string { return ({ pre_sale: '售前咨询', comparison: '产品比较', after_sale: '售后问题', complaint: '投诉建议', purchase_intent: '购买意向' } as Record<string, string>)[k] ?? k }

const CALIBERS = [
  { name: '有效会话', def: '去重 sessionId，且至少触发一次 intent_detected（排除仅打开页面）', num: 'intent_detected 会话', den: '—', dedup: 'sessionId' },
  { name: '推荐触发率', def: 'recommendation_shown 会话 / 有效售前类咨询会话', num: 'recommendation_shown', den: 'intent∈{pre_sale,comparison,purchase_intent}', dedup: 'sessionId' },
  { name: '推荐无结果率', def: 'recommendation_no_match 会话 / recommendation_requested 会话', num: 'no_match', den: 'requested', dedup: 'sessionId' },
  { name: '对比使用率 / 推荐→对比', def: 'compare_started 会话 / recommendation_shown 会话', num: 'compare_started', den: 'recommendation_shown', dedup: 'sessionId' },
  { name: '线索同意率', def: 'lead_consent_granted 会话 / lead_consent_requested 会话', num: 'granted', den: 'requested', dedup: 'sessionId' },
  { name: '对比→线索', def: 'lead_created（purchase）会话 / compare_started 会话', num: 'lead_created', den: 'compare_started', dedup: 'sessionId' },
  { name: 'FAQ 解决率', def: 'faq_resolved 会话 / faq_matched 会话', num: 'resolved', den: 'matched', dedup: 'sessionId' },
  { name: '平均响应时间', def: '引擎本地 processingTimeMs 均值与 P95（不含网络延迟）', num: '事件耗时', den: '—', dedup: '全部事件' },
  { name: '漏斗', def: '有效咨询→推荐→对比→同意→线索→已转化（模拟），逐层去重会话；售后/投诉不进入', num: '各层会话', den: '上一层会话', dedup: 'sessionId' }
]

function loadSample(): void {
  for (const e of generateSampleEvents()) store.track(e.type, { ...e, opKey: e.eventId })
  version.value += 1
  ElMessage.success('已加载 7 天示例数据（固定种子可复现，全部标记 dataOrigin=sample）')
}
function clearSample(): void {
  store.clearSample()
  version.value += 1
  ElMessage.success('已清除示例数据；实际操作、线索、售后与投诉记录不受影响')
}
function clearEvents(): void {
  ElMessageBox.confirm('将清除全部分析事件（不影响线索/售后/投诉记录、商品与FAQ），并记录审计。继续？', '清除分析事件', { type: 'warning' })
    .then(() => {
      store.clearActual()
      version.value += 1
      leadsStore.auditEvent(leadsStore.role.current, 'analytics_events_cleared', null, 'success', '清除全部分析事件（业务记录保留）')
      ElMessage.success('分析事件已清空')
    })
    .catch(() => undefined)
}
function exportMetrics(): void {
  const json = JSON.stringify({ disclaimer: '模拟演示数据导出：不含姓名、完整手机号与聊天原文；示例数据不代表真实经营结果。', filters: filters.value, metrics: m.value }, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'qzad-dashboard-metrics.json'
  a.click()
  URL.revokeObjectURL(blob as unknown as string ? a.href : a.href)
}
onMounted(() => { version.value += 1 })
</script>

<style scoped>
.dash-page { max-width: 1080px; margin: 0 auto; }
.dash-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 22px; margin: 6px 0 4px; }
.page-sub { color: #7a8a99; font-size: 13px; margin: 0 0 12px; max-width: 640px; }
.head-ops { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-bar { margin-bottom: 12px; }
.filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.src-line { font-size: 12px; color: #7a8a99; }
.sample-banner { margin-bottom: 12px; background: #fff7e6; border-color: #f0d9a8; color: #8a5a00; font-size: 13px; }
.gate { text-align: left; }
.kpi-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.kpi { flex: 1; min-width: 130px; background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 12px; }
.kpi b { font-size: 22px; color: #0b6e6e; }
.kpi span { display: block; font-size: 12px; color: #7a8a99; margin-top: 2px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.panel-title { font-size: 14px; margin: 2px 0 10px; }
.funnel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
.f-label { width: 120px; color: #33475b; flex-shrink: 0; }
.f-bar-wrap { flex: 1; background: #eef4f7; border-radius: 4px; height: 14px; overflow: hidden; }
.f-bar { height: 100%; background: linear-gradient(90deg, #0b6e6e, #1a9ea0); }
.f-bar.teal { background: linear-gradient(90deg, #1a9ea0, #4fc3c5); }
.f-bar.green { background: linear-gradient(90deg, #2e8b57, #57b47d); }
.f-num { width: 150px; color: #5b6b7b; font-size: 12px; }
.f-num i { font-style: normal; color: #8a5a00; }
.trend-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.trend-table th, .trend-table td { border-bottom: 1px solid #eef2f6; padding: 6px 8px; text-align: left; }
.kv { font-size: 13px; margin: 6px 0; }
.hint { color: #7a8a99; font-size: 12px; }
.quality { color: #a15c00; font-size: 12px; }
.cal-list { padding-left: 16px; font-size: 13px; line-height: 1.7; }
@media (max-width: 768px) {
  .grid2 { grid-template-columns: 1fr; }
  .f-label { width: 88px; }
  .f-num { width: auto; }
}
</style>
