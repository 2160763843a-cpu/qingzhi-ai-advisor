<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createAdvisor } from '../engine/engine'
import { createBrowserStore } from '../engine/session'
import { fetchFaqs, fetchProducts } from '../api/client'
import type { Faq, Product } from '../types/data'
import type { EngineResponse, SessionContext, SlotKey } from '../engine/types'
import { INTENT_LABELS, LOCAL_NEED_LABELS, PREF_LABELS, SLOT_LABELS, familyPhrase } from '../engine/labels'
import { formatBudget } from '../engine/budget'
import { getAppCompareStore } from '../stores/compare'
import { getAppLeadsStore, CONSENT_PURPOSE_TEXT } from '../stores/leads'
import { maskPhone } from '../engine/leadScore'
const isMultiCat = computed(() => (ctx.value?.slots.categories?.value as string[] | undefined ?? []).length >= 2)
const bundleBudgetText = computed(() => {
  const v = ctx.value?.slots.totalBudget?.value as unknown
  if (typeof v === 'object' && v) return `按总预算 ${(v as { min?: number }).min ?? ''}～${(v as { max?: number }).max ?? ''}元 生成`
  if (v !== undefined && v !== null) return `按总预算 ${String(v)}元 生成`
  return '按当前需求生成'
})
const TRACE_SLOTS: Record<string, string> = { categories: '品类', totalBudget: '总预算', itemBudget: '单品预算', itemBudgetRange: '预算区间', itemBudgetByCategory: '分品类预算', familySize: '家庭人数', familySizeMin: '人数下限', preferences: '偏好', localNeeds: '本地需求', installationDimensions: '安装空间' }
const SLOT_ZH: Record<string, string> = { categories: '关注品类', totalBudget: '总预算', totalBudgetMin: '总预算下限', itemBudget: '单品预算', itemBudgetRange: '预算区间', itemBudgetByCategory: '分品类预算', familySize: '家庭人数', familySizeMin: '家庭人数下限', preferences: '购买偏好', localNeeds: '本地化需求', installationDimensions: '安装空间', purchaseTime: '期望时间', faultSymptoms: '故障现象', complaintResolution: '期望处理方式', contactIntent: '联系意愿' }
const ACTION_ZH: Record<string, string> = { set: '新增', update: '更新', merge: '新增', 'add-item': '新增', 'remove-item': '移除', 'delete-slot': '删除' }
const SIG_TYPE: Record<string, string> = { pattern: '业务短语', context: '对话上下文', continuation: '上下文延续', statistical: '统计语义' }
const shangXiaWenExplain = computed(() => {
  const last = lastResponse.value
  if (!last) return ''
  const sig = last.intent.matchedSignals.find((s) => s.type === 'continuation' || s.type === 'context')
  if (sig) return `本轮主要依据对话上下文理解：${sig.word}。上一轮正在询问信息，因此本条输入被理解为对上一轮问题的补充回答，而不是新的独立问题。`
  if (last.intent.matchedSignals.some((s) => s.type === 'pattern')) return '本轮通过明确的业务短语直接识别意图与条件。'
  if (last.intent.matchedSignals.some((s) => s.type === 'statistical')) return '本轮依据统计语义相似度（本地混合NLU）识别意图。'
  return '本轮未能确定业务意图，进入澄清引导。'
})
const nextDecision = computed(() => {
  const last = lastResponse.value
  if (!last) return ''
  if (last.stage === 'safety') return '检测到安全风险：已优先展示安全指引，暂停一切营销与推荐流程。'
  if (last.ready || last.stage === 'ready') return '当前需求信息已足够，可以直接生成推荐方案。'
  if (last.followupQuestions.length > 0) return `信息尚未完整，仍需确认：${last.followupQuestions.join(' ')}` 
  return '本轮信息已记录。您可以继续补充条件，或直接说“生成推荐方案”。'
})
const TRACE_FIELDS: Record<string, string> = { price: '价格', capacityL: '总容积', freezerCapacityL: '冷冻室容积', deepFreeze: '深冷能力', washCapacityKg: '洗涤容量', noiseDb: '噪声', energyGrade: '能效等级', dimensionsMm: '安装尺寸', familySizeFit: '适用人数', suitableArea: '适用面积', horsepower: '匹数', literL: '升数', inchSize: '屏幕尺寸', placeSets: '套数', stockStatus: '库存', rating: '评分', afterSalesNote: '售后说明', spinSpeedRpm: '脱水转速', heatType: '加热类型', resolution: '分辨率', dryType: '烘干方式' }
import type { PrefKey, LocalNeedKey } from '../engine/types'

const advisor = createAdvisor(createBrowserStore().store)
const compareStore = getAppCompareStore()
const leadsStore = getAppLeadsStore()
const router = useRouter()
const compareVersion = ref(0)
const leadFormVisible = ref(false)
const leadForm = ref({ name: '', phone: '', preferredTime: '', agreed: false })
const leadCreatedCard = ref('')
const catalog = ref<Product[]>([])
const faqList = ref<Faq[]>([])

interface ViewMessage {
  role: 'user' | 'assistant'
  text: string
  turn: number
  safety?: boolean
}

const messages = ref<ViewMessage[]>([])
const input = ref('')
const sending = ref(false)
const errorMsg = ref('')
const lastResponse = ref<EngineResponse | null>(null)
const contextVersion = ref(0)
const listRef = ref<HTMLElement>()
const recPanelRef = ref<InstanceType<typeof import('element-plus')['ElCard']>>()
const showRecPanel = ref(false)

function scrollToRecPanel() {
  nextTick(() => {
    const el = document.getElementById('rec-panel')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const coreConditions = computed(() => {
  const c = ctx.value
  if (!c) return ''
  const parts: string[] = []
  const cats = c.slots.categories?.value as string[] | undefined
  if (cats?.length) parts.push(cats.join('＋'))
  const tbRaw = c.slots.totalBudget?.value as unknown
  if (typeof tbRaw === 'object' && tbRaw) parts.push(`总预算 ${formatBudget({ min: (tbRaw as {min?:number}).min ?? null, max: (tbRaw as {max?:number}).max ?? null })}`)
  else if (c.slots.totalBudget) parts.push(`总预算 ${formatBudget({ exact: c.slots.totalBudget.value as number })}`)
  const range = c.slots.itemBudgetRange?.value as { min?: number; max?: number } | undefined
  if (range) parts.push(`预算 ${formatBudget({ min: range.min ?? null, max: range.max ?? null })}`)
  else if (c.slots.itemBudget) parts.push(`预算 ${formatBudget({ exact: c.slots.itemBudget.value as number, perItem: true })}`)
  if (c.slots.familySize) parts.push(familyPhrase(c.slots.familySize.value as number))
  const prefs = c.slots.preferences?.value as string[] | undefined
  if (prefs?.length) parts.push(`偏好${prefs.map((p) => PREF_LABELS[p as PrefKey] ?? p).join('、')}`)
  const needs = c.slots.localNeeds?.value as string[] | undefined
  if (needs?.length) parts.push(needs.map((n) => LOCAL_NEED_LABELS[n as LocalNeedKey] ?? n).join('、'))
  const dims = c.slots.installationDimensions?.value as { location?: string; width?: number; depth?: number; unit: string }[] | undefined
  if (dims?.length) parts.push(`预留空间 ${dims.map((d) => `${d.location ?? ''} ${d.width ?? '?'}×${d.depth ?? '?'}${d.unit}`).join('、')}`)
  else parts.push('安装尺寸未提供')
  return parts.join(' ｜ ')
})

const emptyInfo = computed(() => recs.value?.empty ?? null)
const relaxOptions = computed(() => emptyInfo.value?.relaxationOptions ?? [])

const reportRows = computed(() => {
  const fp = recs.value?.empty?.filterReport
  if (!fp) return []
  return [
    { stage: '全部商品（模拟池）', count: fp.totalProductsConsidered },
    { stage: '品类匹配后', count: fp.categoryMatched },
    { stage: '库存过滤后', count: fp.afterStockFilter },
    { stage: '预算过滤后', count: fp.afterBudgetFilter },
    { stage: '面积过滤后', count: fp.afterAreaFilter },
    { stage: '容量偏好（软性，不过滤）', count: fp.afterCapacityFilter },
    { stage: '安装尺寸过滤后', count: fp.afterDimensionFilter },
    { stage: '完全匹配结果', count: fp.exactMatchCount }
  ]
})

const anySizePending = computed(() => {
  const c = ctx.value?.recommendations
  if (!c) return false
  return Object.values(c.cards).flat().some((x) => x.sizeFitStatus === '尺寸待确认')
})

const ctx = computed<SessionContext | null>(() => {
  void contextVersion.value
  return advisor.getContext()
})

const EXAMPLES = [
  '我是青岛三口之家，想买冰箱',
  '我想买洗衣机，预算6000元以下',
  '空调用了三年不制冷',
  '我要投诉送货太慢'
]

const lastIntent = computed(() => {
  const hist = ctx.value?.intentHistory ?? []
  return hist.length > 0 ? hist[hist.length - 1] : null
})

const readyHint = computed(() => ctx.value?.stage === 'ready')

const lastQuickOptions = computed(() => {
  const last = messages.value[messages.value.length - 1]
  if (last && last.role === 'assistant' && lastResponse.value) return lastResponse.value.quickOptions
  return []
})

function scrollToBottom() {
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

onMounted(async () => {
  const saved = advisor.getContext()
  if (saved && saved.recentMessages.length > 0) {
    messages.value = saved.recentMessages.map((m) => ({ role: m.role, text: m.text, turn: m.turn }))
    scrollToBottom()
  }
  try {
    const [p, f] = await Promise.all([fetchProducts(), fetchFaqs()])
    const removed = compareStore.prune(p.map((x: { id: string }) => x.id))
    if (removed.length > 0) ElMessage.warning(`已自动移除失效的对比商品：${removed.map((r) => r.name).join('、')}`)
    catalog.value = p
    faqList.value = f
  } catch {
    catalog.value = []
  }
})

const recs = computed(() => ctx.value?.recommendations ?? null)
const recsEmpty = computed(() => Boolean(recs.value?.empty))
const hasAnyCards = computed(() => Object.values(recs.value?.cards ?? {}).flat().length > 0)
const inputRef = ref<InstanceType<typeof import('element-plus')['ElInput']>>()

function budgetToMin(amount: number) {
  void (async () => {
    await send(`预算改成${amount}元`)
    await generateRecommendations(false)
  })()
}

function showNearest() {
  nextTick(() => document.getElementById('empty-alternatives')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function modifyRequirements() {
  inputRef.value?.focus?.()
}

function handleRelax(opt: { action: 'budget_min' | 'show_nearest' | 'modify' }) {
  const minPrice = emptyInfo.value?.insight.minPriceForSuggested
  if (opt.action === 'budget_min' && minPrice) void budgetToMin(minPrice)
  else if (opt.action === 'show_nearest') showNearest()
  else modifyRequirements()
}
const recStale = computed(() => Boolean(recs.value?.stale))
const showRecEntry = computed(() => {
  if (!catalog.value.length) return false
  if (ctx.value?.stage !== 'ready') return false
  return !recs.value || recs.value.stale
})
const recEntryLabel = computed(() => (recs.value && recs.value.stale ? '条件已变化，请重新生成推荐' : '生成推荐方案'))
const candidateCards = computed(() => {
  const c = ctx.value?.recommendations
  if (!c) return []
  const all = Object.values(c.cards).flat()
  return c.candidates.map((id) => all.find((x) => x.productId === id)).filter(Boolean) as NonNullable<typeof all[number]>[]
})

async function generateRecommendations(nextBatch = false) {
  if (!catalog.value.length || sending.value) return
  sending.value = true
  try {
    const res = advisor.generateRecommendations(catalog.value, { nextBatch })
    contextVersion.value += 1
    if (res.refused) {
      messages.value.push({ role: 'assistant', text: res.refused.message, turn: ctx.value?.turnCount ?? 0 })
      lastResponse.value = null
      scrollToBottom()
    } else {
      const c = ctx.value?.recommendations
      const n = c ? Object.values(c.cards).flat().length : 0
      const bCount = c?.bundles.length ?? 0
      showRecPanel.value = true
      messages.value.push({
        role: 'assistant',
        text: `已生成${n}款候选${bCount > 0 ? `和${bCount}套组合方案` : ''}，请查看下方推荐方案。点击卡片可展开评分依据。`,
        turn: ctx.value?.turnCount ?? 0
      })
      scrollToBottom()
      scrollToRecPanel()
    }
  } finally {
    sending.value = false
  }
}

async function adjustBudget() {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的预算（元），例如：8000', '调整预算', {
      inputValue: String(ctx.value?.slots.totalBudget?.value ?? ctx.value?.slots.itemBudget?.value ?? ''),
      confirmButtonText: '应用',
      cancelButtonText: '取消',
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入数字金额'
    })
    if (value) {
      await send(`预算改成${value}元`)
    }
  } catch {
    // 取消
  }
}

function preferDimension(kind: '节能' | '静音') {
  void send(`更重视${kind}`)
}

function useMockPhone(): void {
  leadForm.value.phone = '13800008000'
}
async function submitLeadForm(): Promise<void> {
  const phoneOk = /^1[3-9]\d{9}$/.test(leadForm.value.phone)
  if (!phoneOk || !leadForm.value.agreed) return
  const ctxSnapshot = advisor.getContext()
  if (!ctxSnapshot) return
  const rec = leadsStore.createPurchaseLead({
    ctx: ctxSnapshot,
    sessionId: ctxSnapshot.sessionId,
    contact: { name: leadForm.value.name || undefined, phone: leadForm.value.phone, preferredTime: leadForm.value.preferredTime || undefined },
    consentGiven: true,
    source: '聊天指令',
    productIds: [...(ctxSnapshot.recommendations?.candidates ?? [])],
    comparisonIds: compareStore.items.map((i) => i.productId)
  })
  leadCreatedCard.value = `线索编号 ${rec.id} ｜ 意向 ${rec.intentScore} 分（${rec.intentLevel}）｜ 联系方式 ${maskPhone(rec.contact?.phone ?? '')} ｜ 状态：${rec.status}（模拟）。该记录仅保存在当前浏览器，可在“线索管理”查看、导出或删除。`
  leadFormVisible.value = false
  contextVersion.value += 1
}

async function handleCompareClick(productId: string) {
  const product = catalog.value.find((x) => x.id === productId)
  if (!product) return
  const r = compareStore.add(product, '推荐卡')
  compareVersion.value += 1
  if (r.ok) {
    if (compareStore.count >= 2) {
      try {
        await ElMessageBox.confirm(`已加入对比（${compareStore.count}/3）。要立即查看对比吗？`, '加入对比成功', {
          confirmButtonText: '立即查看',
          cancelButtonText: '继续选购',
          type: 'success'
        })
        router.push('/compare')
      } catch { /* 继续选购 */ }
    } else {
      ElMessage.success(`已加入对比（${compareStore.count}/3），请再选择至少 1 款`)
    }
    return
  }
  if (r.code === 'duplicate') { ElMessage.info('该商品已在对比列表中'); return }
  if (r.code === 'category_mismatch') {
    try {
      await ElMessageBox.confirm(
        `不同品类适合组成家庭方案，不适合逐项参数比较。当前对比列表是「${r.existingCategory}」（${r.existingName}）。是否用「${product.name}」替换当前对比列表？`,
        '品类不同',
        { confirmButtonText: '替换对比列表', cancelButtonText: '保留当前品类', type: 'warning' }
      )
      compareStore.replaceWith(product, '推荐卡')
      compareVersion.value += 1
      ElMessage.success('已替换对比列表')
    } catch { ElMessage.info('已保留当前品类对比列表') }
    return
  }
  if (r.code === 'full') {
    const snapshot = [...compareStore.items]
    for (const item of snapshot) {
      try {
        await ElMessageBox.confirm(
          `对比列表已满（3/3）。是否移除「${item.name}」并加入「${product.name}」？`,
          '选择要移除的商品',
          { confirmButtonText: `移除「${item.name}」`, cancelButtonText: '看看下一款' }
        )
        compareStore.removeById(item.productId, '推荐卡')
        compareStore.add(product, '推荐卡')
        compareVersion.value += 1
        ElMessage.success('已更新对比列表')
        return
      } catch { /* 继续询问下一款 */ }
    }
    ElMessage.info('已保留当前对比列表；可先移除后再加入')
  }
}

function toggleCandidate(productId: string, add: boolean, info?: { name: string; price: number; category: string }) {
  advisor.toggleCandidate(productId, add, info)
  contextVersion.value += 1
}

async function addSizeInfo() {
  try {
    const { value } = await ElMessageBox.prompt('请描述预留空间，例如：厨房预留宽700深650，阳台宽620深600', '补充安装尺寸', {
      inputValue: '',
      confirmButtonText: '提交',
      cancelButtonText: '取消'
    })
    if (value && value.trim()) await send(value.trim())
  } catch {
    // 取消
  }
}

async function send(text: string) {
  const content = text.trim()
  if (!content || sending.value) return
  sending.value = true
  errorMsg.value = ''
  messages.value.push({ role: 'user', text: content, turn: (ctx.value?.turnCount ?? 0) + 1 })
  input.value = ''
  scrollToBottom()
  try {
    const resp = advisor.processMessage(content, faqList.value)
    lastResponse.value = resp
    messages.value.push({ role: 'assistant', text: resp.reply, turn: ctx.value?.turnCount ?? 0, safety: resp.safety?.safetyLevel === 'emergency' })
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '处理消息时出现问题'
  } finally {
    contextVersion.value += 1
    sending.value = false
    scrollToBottom()
  }
}

async function clearSession() {
  try {
    let alsoClearCompare = false
    if (compareStore.items.length > 0) {
      try {
        await ElMessageBox.confirm('当前有对比商品，是否同时清空对比列表？', '清空对比列表', {
          confirmButtonText: '同时清空对比',
          cancelButtonText: '仅清空会话',
          type: 'warning'
        })
        alsoClearCompare = true
      } catch { /* 仅清空会话 */ }
    }
    await ElMessageBox.confirm('将清空当前会话与已提取的需求条件，确定继续吗？', '清空会话', {
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
    if (alsoClearCompare) {
      compareStore.clear('推荐卡')
      compareVersion.value += 1
    }
    advisor.resetSession()
    messages.value = []
    lastResponse.value = null
    contextVersion.value += 1
  } catch {
    // 用户取消
  }
}

async function removeCondition(key: SlotKey) {
  try {
    await ElMessageBox.confirm(`确定删除条件「${SLOT_LABELS[key]}」吗？`, '删除条件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    advisor.removeSlot(key)
    contextVersion.value += 1
  } catch {
    // 用户取消
  }
}

async function editCondition(key: SlotKey, current: string) {
  try {
    const { value } = await ElMessageBox.prompt(`用一句话修改「${SLOT_LABELS[key]}」，例如：预算改成9000元`, '修改条件', {
      inputValue: current,
      confirmButtonText: '应用',
      cancelButtonText: '取消'
    })
    if (value && value.trim()) {
      const resp = advisor.processMessage(value.trim())
      lastResponse.value = resp
      messages.value.push({ role: 'user', text: value.trim(), turn: ctx.value?.turnCount ?? 0 })
      messages.value.push({ role: 'assistant', text: resp.reply, turn: ctx.value?.turnCount ?? 0 })
      contextVersion.value += 1
      scrollToBottom()
    }
  } catch {
    // 用户取消
  }
}

interface SummaryRow {
  key: SlotKey
  label: string
  value: string
  turn: number
}

function fmtDim(v: unknown): string {
  const arr = v as { location?: string; width?: number; depth?: number; height?: number; unit: string }[]
  return arr
    .map((d) => `${d.location ?? '安装位'} ${[d.width && `宽${d.width}`, d.depth && `深${d.depth}`, d.height && `高${d.height}`].filter(Boolean).join('×')}${d.unit}`)
    .join('；')
}

const summaryRows = computed<SummaryRow[]>(() => {
  const c = ctx.value
  if (!c) return []
  const rows: SummaryRow[] = []
  const pushRow = (key: SlotKey, value: string) => {
    const sv = c.slots[key]
    if (sv) rows.push({ key, label: SLOT_LABELS[key], value, turn: sv.turn })
  }
  const cats = c.slots.categories?.value as string[] | undefined
  if (cats) pushRow('categories', cats.join('、'))
  const tbRaw = c.slots.totalBudget?.value as unknown
  if (typeof tbRaw === 'object' && tbRaw) pushRow('totalBudget', formatBudget({ min: (tbRaw as { min?: number }).min ?? null, max: (tbRaw as { max?: number }).max ?? null }))
  else if (c.slots.totalBudget) pushRow('totalBudget', formatBudget({ exact: c.slots.totalBudget.value as number }))
  const range = c.slots.itemBudgetRange?.value as { min: number; max: number } | undefined
  if (range) pushRow('itemBudgetRange', formatBudget({ min: range.min ?? null, max: range.max ?? null }))
  if (c.slots.itemBudget) pushRow('itemBudget', formatBudget({ exact: c.slots.itemBudget.value as number, perItem: true }))
  const byCat = c.slots.itemBudgetByCategory?.value as Record<string, number> | undefined
  if (byCat && Object.keys(byCat).length > 0) {
    pushRow('itemBudgetByCategory', Object.entries(byCat).map(([k, v]) => `${k} ${v} 元`).join('，'))
  }
  if (c.slots.familySize) pushRow('familySize', `${c.slots.familySize.value} 人`)
  if (c.slots.houseArea) pushRow('houseArea', `${c.slots.houseArea.value} ㎡`)
  if (c.slots.roomArea) pushRow('roomArea', `${c.slots.roomArea.value} ㎡`)
  if (c.slots.installationDimensions) pushRow('installationDimensions', fmtDim(c.slots.installationDimensions.value))
  if (c.slots.location) pushRow('location', String(c.slots.location.value))
  const prefs = c.slots.preferences?.value as PrefKey[] | undefined
  if (prefs && prefs.length > 0) pushRow('preferences', prefs.map((p) => PREF_LABELS[p] ?? p).join('、'))
  const needs = c.slots.localNeeds?.value as LocalNeedKey[] | undefined
  if (needs && needs.length > 0) pushRow('localNeeds', needs.map((n) => LOCAL_NEED_LABELS[n] ?? n).join('、'))
  if (c.slots.purchaseTime) pushRow('purchaseTime', String(c.slots.purchaseTime.value))
  if (c.slots.ownedDuration) pushRow('ownedDuration', String(c.slots.ownedDuration.value))
  const faults = c.slots.faultSymptoms?.value as string[] | undefined
  if (faults && faults.length > 0) pushRow('faultSymptoms', faults.join('、'))
  if (c.slots.faultDuration) pushRow('faultDuration', String(c.slots.faultDuration.value))
  if (c.slots.complaintTopic) pushRow('complaintTopic', String(c.slots.complaintTopic.value))
  if (c.slots.complaintResolution) pushRow('complaintResolution', String(c.slots.complaintResolution.value))
  if (c.slots.orderRef) pushRow('orderRef', String(c.slots.orderRef.value))
  if (c.slots.suggestion) pushRow('suggestion', String(c.slots.suggestion.value))
  if (c.slots.contactIntent?.value === true) pushRow('contactIntent', '愿意进入后续联系流程')
  return rows
})
</script>

<template>
  <el-row :gutter="16" class="chat-layout">
    <el-col :xs="24" :md="15">
      <el-card shadow="never" class="chat-card">
        <template #header>
          <div class="chat-head">
            <div class="intent-chip">
              <el-tag size="small" type="primary" effect="plain">意图：{{ lastIntent ? INTENT_LABELS[lastIntent.intent] : '待开始' }}</el-tag>
              <el-tag v-if="lastIntent" size="small" type="info" effect="plain">识别置信度 {{ Math.round(lastIntent.confidence * 100) }}%</el-tag>
              <el-tag v-if="readyHint" size="small" type="success" effect="plain">需求信息已基本完整</el-tag>
            </div>
            <el-button size="small" type="danger" plain @click="clearSession">清空会话</el-button>
          </div>
        </template>

        <el-alert
          type="info"
          :closable="false"
          class="engine-note"
          title="本地混合 NLU 驱动 · 数据均为模拟"
        />

        <div ref="listRef" class="msg-list">
          <template v-if="messages.length === 0">
            <div class="empty">
              <p class="hello">您好！我是青智家智能助手（模拟演示）。</p>
              <p class="hello-sub">告诉我您的需求，我会记录预算、人数、空间尺寸、节能静音偏好等条件；点击示例问题或直接输入开始对话。</p>
              <div class="examples">
                <el-button v-for="e in EXAMPLES" :key="e" size="small" round plain type="primary" @click="send(e)">{{ e }}</el-button>
              </div>
            </div>
          </template>
          <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
            <div class="bubble" :class="{ safety: m.safety }">{{ m.text }}</div>
            <div v-if="m.role === 'assistant' && i === messages.length - 1 && lastQuickOptions.length > 0" class="quick">
              <el-button v-for="q in lastQuickOptions" :key="q" size="small" round @click="send(q)">{{ q }}</el-button>
            </div>
          </div>
          <div v-if="sending" class="msg assistant">
            <div class="bubble typing">分析中...</div>
          </div>
          <div v-if="errorMsg" class="msg assistant">
            <div class="bubble error">处理出现问题：{{ errorMsg }}</div>
            <el-button size="small" type="warning" plain @click="errorMsg = ''">关闭并重试</el-button>
          </div>
        </div>

        <div class="input-row">
          <el-input
            v-model="input"
            placeholder="请输入您的需求…"
            :disabled="sending"
            clearable
            @keyup.enter="send(input)"
          />
          <el-button type="primary" :disabled="sending || !input.trim()" @click="send(input)">发送</el-button>
        </div>
        <div v-if="showRecEntry" class="rec-entry">
          <el-button type="warning" size="large" :disabled="sending" @click="generateRecommendations(false)">{{ recEntryLabel }}</el-button>
        </div>
      </el-card>

      <el-card v-if="recs && recsEmpty" id="rec-panel" shadow="never" class="rec-card">
        <template #header>
          <div class="rec-head">
            <span>推荐结果（模拟数据）</span>
            <el-button v-if="recStale" size="small" type="warning" @click="generateRecommendations(false)">按新条件重新生成</el-button>
          </div>
        </template>

        <el-alert type="warning" :closable="false" :title="emptyInfo?.message ?? ''" class="stale-tip" />
        <div class="core-conds">当前条件：{{ coreConditions || emptyInfo?.categoriesText }}</div>

        <div class="empty-status">
          <el-tag type="danger" effect="dark">没有完全匹配商品</el-tag>
          <span class="conflict">{{ emptyInfo?.filterReport.primaryConflict }}</span>
        </div>

        <div class="empty-insight">
          <p style="font-size:14px; color:#1F2D3D; line-height:1.8; margin:8px 0;">{{ emptyInfo?.message }}</p>
        </div>

        <div class="relax-ops">
          <el-button
            v-for="opt in relaxOptions"
            :key="opt.action"
            :type="opt.action === 'budget_min' ? 'primary' : 'default'"
            size="small"
            @click="handleRelax(opt)"
          >{{ opt.label }}</el-button>
        </div>

        <div id="empty-alternatives" class="alt-block">
          <el-alert type="info" :closable="false" title="以下商品不完全满足原条件（最接近方案，与完全匹配结果分开展示）" />
          <!-- 最接近方案列表 -->
          <el-card v-for="card in emptyInfo?.alternatives ?? []" :key="card.productId" shadow="hover" class="rec-item">
            <div class="rec-item-head">
              <div><span class="rec-score">{{ card.totalScore.toFixed(1) }}分</span><span class="rec-name">{{ card.name }}</span></div>
              <div class="rec-price"><span class="p">{{ card.price.toLocaleString() }}元</span></div>
            </div>
            <ul class="rec-reasons"><li v-for="(r, i) in card.reasons" :key="i">满足：{{ r }}</li></ul>
            <div class="rec-caveats">{{ card.caveats[0] }}</div>
            <div class="rec-item-ops">
              <el-button size="small" type="primary" plain @click="toggleCandidate(card.productId, true, { name: card.name, price: card.price, category: card.category })">加入候选</el-button>
            </div>
          </el-card>
        </div>

        <el-collapse class="rec-why">
          <el-collapse-item title="为什么没有匹配结果（过滤报告）" name="report">
            <el-table :data="reportRows" size="small" border>
              <el-table-column prop="stage" label="过滤阶段" />
              <el-table-column prop="count" label="剩余数量" width="100" />
            </el-table>
            <p class="basis-line">主要冲突：{{ emptyInfo?.filterReport.primaryConflict }}；{{ emptyInfo?.capacityNote }}</p>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <el-card v-if="recs && hasAnyCards" id="rec-panel" ref="recPanelRef" shadow="never" class="rec-card" :class="{ stale: recStale }">
        <template #header>
          <div class="rec-head">
            <span>推荐方案（模拟数据）</span>
            <el-button v-if="recStale" size="small" type="warning" @click="generateRecommendations(false)">按新条件重新生成</el-button>
          </div>
        </template>

        <div class="core-conds">当前条件：{{ coreConditions || '（尚未识别到条件）' }}</div>
        <div v-if="anySizePending" class="size-pending">
          <el-button size="small" type="primary" plain @click="addSizeInfo">补充安装尺寸</el-button>
        </div>
        <div class="rec-ops">
          <el-button size="small" plain @click="adjustBudget">调整预算</el-button>
          <el-button size="small" plain @click="preferDimension('节能')">更重视节能</el-button>
          <el-button size="small" plain @click="preferDimension('静音')">更重视静音</el-button>
          <el-button size="small" plain type="primary" @click="generateRecommendations(true)">换一批</el-button>
        </div>

        <el-alert
          v-if="recStale"
          type="warning"
          :closable="false"
          class="stale-tip"
          title="条件已变化，请重新生成"
          description="你调整了需求条件，以下为历史推荐结果，已自动标记失效。点击上方按钮重新生成。"
        />

        <div v-for="(cards, cat) in recs.cards" :key="cat" class="rec-group" :class="{ dim: recStale }">
          <div class="rec-cat">{{ cat }}{{ isMultiCat ? '候选（' + cards.length + '款可参与预算内组合）' : '推荐（' + cards.length + '款符合硬性条件）' }}</div>
          <el-card v-for="card in cards" :key="card.productId" shadow="hover" class="rec-item">
            <div class="rec-item-head">
              <div>
                <span class="rec-score">{{ card.totalScore.toFixed(1) }}分</span>
                <span class="rec-name">{{ card.name }}</span>
              </div>
              <div class="rec-price">
                <span class="p">{{ card.price.toLocaleString() }}元</span>
                <el-tag v-if="card.budgetExceed" size="small" type="warning">超出{{ card.budgetExceed }}元待确认</el-tag>
                <el-tag size="small" :type="card.sizeFitStatus === '匹配' ? 'success' : card.sizeFitStatus === '超限' ? 'danger' : 'info'">{{ card.sizeFitStatus }}</el-tag>
              </div>
            </div>
            <ul class="rec-reasons">
              <li v-for="(r, i) in card.reasons" :key="i">{{ r }}</li>
            </ul>
            <div v-if="card.caveats.length" class="rec-caveats">待注意：{{ card.caveats.join('；') }}</div>
            <div class="rec-item-ops">
              <el-button size="small" type="primary" plain @click="toggleCandidate(card.productId, true, { name: card.name, price: card.price, category: card.category })">加入候选</el-button>
              <el-button size="small" plain @click="handleCompareClick(card.productId)">加入对比</el-button>
            </div>
            <el-collapse class="rec-why">
              <el-collapse-item title="为什么推荐（评分依据）" name="why">
                <el-table :data="card.subScores" size="small" border>
                  <el-table-column prop="label" label="维度" width="120" />
                  <el-table-column prop="weight" label="权重" width="60" />
                  <el-table-column prop="score" label="得分" width="60" />
                  <el-table-column prop="reason" label="依据（可追溯到你的需求与商品字段）" />
                </el-table>
                <p class="rec-trace">本次使用的需求条件：{{ card.usedSlots.map((k) => TRACE_SLOTS[k] ?? k).join('、') }}；本次引用的商品数据：{{ card.usedFields.map((k) => TRACE_FIELDS[k] ?? k).join('、') }}</p>
              </el-collapse-item>
            </el-collapse>
          </el-card>
        </div>

        <template v-if="recs.bundles.length > 0">
          <div class="rec-cat">多品类组合方案（{{ bundleBudgetText }}）</div>
          <el-card v-for="b in recs.bundles" :key="b.strategy" :data-bundle-key="b.items.map(i => i.productId).sort().join('|')" shadow="hover" class="rec-item">
            <div class="rec-item-head">
              <div><span class="rec-score">{{ Number(b.compositeScore.toFixed ? b.compositeScore.toFixed(1) : b.compositeScore) }}分</span><span class="rec-name">{{ b.name }}</span></div>
              <div class="rec-price">
                <span class="p">合计 {{ b.totalPrice.toLocaleString() }} 元</span>
                <el-tag size="small" :type="b.budgetDiff > 0 ? 'warning' : 'success'">{{ b.budgetDiff > 0 ? `超出${b.budgetDiff}元待确认` : `低于预算${-b.budgetDiff}元` }}</el-tag>
              </div>
            </div>
            <p class="bundle-line">构成：{{ b.items.map((x) => `${x.category} ${x.name}（${x.price.toLocaleString()}元）`).join(' + ') }}</p>
            <p class="bundle-line">预算分配：{{ b.allocationText }}</p>
            <ul class="rec-reasons"><li v-for="(a, i) in b.advantages" :key="i">方案优势：{{ a }}</li></ul>
            <p v-if="b.tradeoffs.length" class="rec-caveats">主要取舍：{{ b.tradeoffs.join('；') }}</p>
            <p class="bundle-line">安装提醒：{{ b.sizeReminder }}<template v-if="b.pendingInfo.length">；待确认：{{ b.pendingInfo.join('；') }}</template></p>
            <p class="bundle-line">适合画像：{{ b.portrait }}</p>
            <div class="rec-item-ops">
              <el-button size="small" type="primary" plain @click="b.items.forEach((x) => toggleCandidate(x.productId, true, { name: x.name, price: x.price, category: x.category }))">整套加入候选</el-button>
            </div>
          </el-card>
        </template>
        <div v-if="recs.infeasible.length" class="rec-caveats infeasible">
          <div v-for="(f, i) in recs.infeasible" :key="i">暂无完全匹配：{{ f.strategy }}——{{ f.reason }}</div>
        </div>
        <div v-if="recs.nearest" class="rec-caveats">
          最接近方案（不作为完全匹配推荐）：{{ recs.nearest.name }}；差距：{{ recs.nearest.gaps.join('；') }}
        </div>
        <div v-if="candidateCards.length" class="cand-box">
          <span class="cond-label">已选候选（{{ candidateCards.length }}）：</span>
          <el-tag
            v-for="c in candidateCards"
            :key="c.productId"
            closable
            type="primary"
            effect="plain"
            @close="toggleCandidate(c.productId, false)"
          >{{ c.name }}（{{ c.price.toLocaleString() }}元）</el-tag>
        </div>
        <div v-if="compareStore.items.length" :key="compareVersion" class="cmp-hint">
          对比列表（{{ compareStore.count }}/3，{{ compareStore.category }}）：{{ compareStore.items.map((i) => i.name).join('、') }}
          <el-tooltip :content="compareStore.count >= 2 ? '' : '还需要再选择 1 款商品才能对比'" placement="top">
            <span>
              <el-button size="small" type="primary" link :disabled="compareStore.count < 2" @click="router.push('/compare')">查看对比</el-button>
            </span>
          </el-tooltip>
          <el-button size="small" link @click="compareStore.clear('候选列表'); compareVersion += 1">清空对比</el-button>
        </div>
      </el-card>
    </el-col>

    <el-col :xs="24" :md="9">
      <el-card shadow="never" class="side-card">
        <el-collapse>
          <el-collapse-item title="本轮理解与决策依据（供评审核对）" name="basis">
            <template v-if="lastResponse">
              <h4 class="bsec">1. 本轮理解</h4>
              <p class="basis-line">主要意图：{{ INTENT_LABELS[lastResponse.intent.primaryIntent] }}</p>
              <p class="basis-line">识别置信度：{{ Math.round(lastResponse.intent.confidence * 100) }}%</p>
              <p class="basis-line">次要意图：{{ lastResponse.intent.alternativeIntent ? INTENT_LABELS[lastResponse.intent.alternativeIntent] : '无' }}</p>
              <p class="basis-line">是否需要澄清：{{ lastResponse.intent.needsClarification ? '是' : '否' }}</p>

              <h4 class="bsec">2. 识别到的信息</h4>
              <template v-if="lastResponse.slotChanges.length > 0">
                <p v-for="(c, i) in lastResponse.slotChanges" :key="i" class="basis-change">用户表达已归一为：{{ c.detail }}（归属条件：{{ SLOT_ZH[c.key] ?? c.key }}）</p>
              </template>
              <p v-else class="basis-line">本轮没有识别到新的条件信息。</p>

              <h4 class="bsec">3. 上下文判断</h4>
              <p class="basis-line">{{ shangXiaWenExplain }}</p>

              <h4 class="bsec">4. 本轮条件变化</h4>
              <template v-if="lastResponse.slotChanges.length > 0">
                <p v-for="(c, i) in lastResponse.slotChanges" :key="i" class="basis-change">{{ c.detail }} ｜ 来源：第{{ c.turn }}轮 ｜ 操作：{{ ACTION_ZH[c.action] ?? c.action }}</p>
              </template>
              <p v-else class="basis-line">本轮条件无变化。</p>

              <h4 class="bsec">5. 下一步决策</h4>
              <p class="basis-line">{{ nextDecision }}</p>

              <el-collapse class="tech-fold">
                <el-collapse-item title="查看技术细节" name="tech">
                  <p class="basis-line">命中信号（已中文化）：</p>
                  <el-table :data="lastResponse.intent.matchedSignals" size="small" border>
                    <el-table-column label="信号类型" width="110"><template #default="{ row }">{{ SIG_TYPE[row.type as string] ?? row.type }}</template></el-table-column>
                    <el-table-column label="支持意图" width="140"><template #default="{ row }">{{ INTENT_LABELS[row.intent as keyof typeof INTENT_LABELS] }}</template></el-table-column>
                    <el-table-column label="贡献程度" width="90"><template #default="{ row }">{{ row.weight >= 1.5 ? '高' : row.weight >= 1 ? '中' : '低' }}</template></el-table-column>
                    <el-table-column prop="word" label="命中原因" />
                  </el-table>
                  <p class="basis-line">本地处理耗时：{{ lastResponse.intent.processingTimeMs < 1 ? '小于1毫秒' : lastResponse.intent.processingTimeMs + '毫秒' }}</p>
                </el-collapse-item>
              </el-collapse>
            </template>
            <p v-else class="basis-line">发送第一条消息后，这里会展示本轮理解与决策依据。</p>
          </el-collapse-item>
        </el-collapse>
      </el-card>

      <el-card shadow="never" class="side-card">
        <template #header>
          <div class="summary-head">
            <span>需求摘要（模拟数据）</span>
            <span class="summary-tip">可修改或删除单个条件</span>
          </div>
        </template>
        <el-empty v-if="summaryRows.length === 0" description="暂无已识别的条件，开始对话后自动生成" :image-size="60" />
        <div v-for="row in summaryRows" :key="row.key" class="cond-row">
          <div class="cond-main">
            <span class="cond-label">{{ row.label }}</span>
            <span class="cond-value">{{ row.value }}</span>
            <span class="cond-turn">第{{ row.turn }}轮</span>
          </div>
          <div class="cond-ops">
            <el-button size="small" text type="primary" @click="editCondition(row.key, row.value)">修改</el-button>
            <el-button size="small" text type="danger" @click="removeCondition(row.key)">删除</el-button>
          </div>
        </div>
        <el-alert
          v-if="readyHint"
          type="success"
          :closable="false"
          class="ready-tip"
          title="信息已经足够，可以生成推荐方案。"
        />
      </el-card>
    </el-col>
  </el-row>

<el-dialog v-model="leadFormVisible" title="联系方式（独立表单·模拟演示）" width="420px" :close-on-click-modal="false">
  <p class="lead-consent-text">{{ CONSENT_PURPOSE_TEXT }}</p>
  <el-form label-width="110px" size="small">
    <el-form-item label="称呼（可选）"><el-input v-model="leadForm.name" placeholder="怎么称呼你" /></el-form-item>
    <el-form-item label="手机号（必填）">
      <div class="phone-row">
        <el-input v-model="leadForm.phone" placeholder="11位手机号" maxlength="11" />
        <el-button size="small" @click="useMockPhone">使用模拟号码</el-button>
      </div>
    </el-form-item>
    <el-form-item label="期望联系时间"><el-input v-model="leadForm.preferredTime" placeholder="可选，如：工作日晚上" /></el-form-item>
    <el-form-item><el-checkbox v-model="leadForm.agreed">我同意仅为生成本次竞赛演示记录填写上述信息（默认不勾选）</el-checkbox></el-form-item>
  </el-form>
  <p v-if="leadForm.phone && !/^1[3-9]\d{9}$/.test(leadForm.phone)" class="lead-err">手机号格式不正确（11位、1开头）</p>
  <p class="lead-hint">竞赛演示时建议只使用模拟信息；提交后默认仅显示脱敏号码。</p>
  <template #footer>
    <el-button @click="leadFormVisible = false">取消</el-button>
    <el-button type="primary" :disabled="!/^1[3-9]\d{9}$/.test(leadForm.phone) || !leadForm.agreed" @click="submitLeadForm">提交并生成线索卡片</el-button>
  </template>
</el-dialog>

<div v-if="leadCreatedCard" class="lead-card" role="status">{{ leadCreatedCard }}</div>

</template>

<style scoped>
.chat-layout {
  margin-top: 4px;
}
.chat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.intent-chip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.engine-note {
  margin-bottom: 10px;
}
.engine-note :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.6;
}
.msg-list {
  height: 420px;
  overflow-y: auto;
  padding: 4px 2px;
  background: #f7fafb;
  border-radius: 8px;
}
.msg {
  display: flex;
  flex-direction: column;
  margin: 10px 8px;
}
.msg.user {
  align-items: flex-end;
}
.msg.assistant {
  align-items: flex-start;
}
.bubble {
  max-width: 78%;
  padding: 9px 13px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.msg.user .bubble {
  background: #0b6e6e;
  color: #fff;
}
.msg.assistant .bubble {
  background: #fff;
  border: 1px solid #e2e9ee;
  color: #1f2d3d;
}
.msg.assistant .bubble.safety {
  border: 2px solid #d03030;
  background: #fff5f5;
  color: #7a1010;
  font-weight: 600;
}
.bubble.typing {
  color: #7a8a99;
}
.bubble.error {
  border-color: #f3b9b9;
  color: #b03030;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.empty {
  text-align: center;
  padding: 40px 16px;
}
.hello {
  font-size: 17px;
  font-weight: 600;
  color: #0b6e6e;
}
.hello-sub {
  color: #7a8a99;
  font-size: 13px;
  margin: 8px 0 16px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.input-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.side-card {
  margin-bottom: 12px;
}
.basis-line {
  font-size: 12px;
  color: #4a5a68;
  margin: 6px 0;
  line-height: 1.6;
}
.basis-change {
  font-size: 12px;
  color: #0b6e6e;
  margin: 4px 0;
}
.summary-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.summary-tip {
  font-size: 12px;
  color: #9aa8b5;
}
.cond-row {
  padding: 7px 2px;
  border-bottom: 1px dashed #edf1f4;
}
.cond-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}
.cond-label {
  font-size: 12px;
  color: #7a8a99;
  min-width: 96px;
}
.cond-value {
  font-size: 13px;
  color: #1f2d3d;
  font-weight: 600;
}
.cond-turn {
  font-size: 11px;
  color: #b0bcc7;
}
.cond-ops {
  margin-top: 2px;
}
.ready-tip {
  margin-top: 10px;
}

.rec-entry {
  margin-top: 12px;
  text-align: center;
}
.rec-card {
  margin-top: 12px;
}
.rec-card.stale {
  opacity: 0.72;
}
.rec-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.rec-ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.stale-tip {
  margin-bottom: 10px;
}
.rec-group {
  margin-bottom: 14px;
}
.rec-group.dim {
  opacity: 0.75;
}
.rec-cat {
  font-weight: 600;
  color: #0b6e6e;
  margin: 6px 0 8px;
}
.rec-item {
  margin-bottom: 10px;
}
.rec-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.rec-score {
  display: inline-block;
  background: #0b6e6e;
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  font-weight: 700;
  margin-right: 8px;
}
.rec-name {
  font-weight: 600;
  color: #1f2d3d;
}
.rec-price {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.rec-price .p {
  font-weight: 700;
  color: #b03030;
}
.rec-reasons {
  margin: 8px 0 4px;
  padding-left: 18px;
  color: #4a5a68;
  font-size: 13px;
  line-height: 1.7;
}
.rec-caveats {
  font-size: 12px;
  color: #a06030;
  margin: 4px 0;
  line-height: 1.6;
}
.infeasible {
  color: #b03030;
}
.rec-item-ops {
  margin-top: 6px;
  display: flex;
  gap: 8px;
}
.rec-why {
  margin-top: 6px;
}
.rec-trace {
  font-size: 12px;
  color: #7a8a99;
  margin: 8px 0 2px;
  line-height: 1.6;
}
.bundle-line {
  font-size: 13px;
  color: #4a5a68;
  line-height: 1.7;
  margin: 4px 0;
}
.empty-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.conflict {
  font-size: 13px;
  color: #b03030;
  font-weight: 600;
}
.empty-insight {
  background: #f7fafb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: #4a5a68;
  line-height: 1.8;
  margin-bottom: 10px;
}
.cap-note {
  color: #7a8a99;
  font-size: 12px;
}
.relax-ops {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.alt-block {
  margin-bottom: 12px;
}
.cand-box {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.core-conds {
  font-size: 12px;
  color: #4a5a68;
  background: #f0f7f7;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 8px;
  line-height: 1.6;
}
.size-pending {
  margin-bottom: 8px;
}
.lead-consent-text { font-size: 12px; color: #5b6b7b; line-height: 1.7; margin: 0 0 10px; }
.phone-row { display: flex; gap: 8px; width: 100%; }
.lead-err { color: #a33; font-size: 12px; margin: 4px 0; }
.lead-hint { color: #7a8a99; font-size: 12px; }
.lead-card { position: fixed; right: 16px; bottom: 16px; max-width: 380px; background: #f0f9f4; border: 1px solid #d6ede0; border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.7; z-index: 20; }
</style>
