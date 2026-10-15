import { CHITCHAT_DIRECTIONS, HIGH_RISK_FAULT } from './lexicons.ts'
import { familyPhrase, localNeedLabel, prefLabel } from './labels.ts'
import { computeFollowups, readyState, isReadyForRecommend, type FollowupQuestion } from './followup.ts'
import { recognizeIntent } from './recognizer.ts'
import { extractSlots, sanitizeRaw } from './extractor.ts'
import { createSessionContext, logChange, SessionStore } from './session.ts'
import { recommendFromSlots, scoreForComparison, type SlotsInput, type RecRefusal } from './recommend.ts'
import { detectSafety, safetyAlertText, safetyCautionText } from './safety.ts'
import { searchFaq } from './kb.ts'
import { resolvePendingAnswer, PENDING_QUESTIONS, type PendingAnswer } from './pending.ts'
import { formatBudget, budgetFromSlots } from './budget.ts'
import { getAppLeadsStore } from '../stores/leads.ts'
import { getAppAnalyticsStore } from '../stores/analytics.ts'
import { detectPurchaseIntent, scorePurchaseLead, COMMERCE_ASK_RE, EXPLICIT_BUY_RE, CONSENT_PURPOSE_TEXT } from './leadScore.ts'
import type { ComplaintRecord, DialogueState } from './types.ts'
import type { Faq } from '../types/data.ts'
import type { Product } from '../types/data.ts'
import type {
  ChangeLogEntry,
  EngineResponse,
  IntentKey,
  SessionContext,
  SlotKey,
  SlotValue
} from './types.ts'

function isPseudoKey(key: SlotKey): boolean {
  return key.startsWith('__')
}

function nextTicketId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `QZ-${s}`
}

// 比较指代：必须出现明确的候选指代词，避免误伤普通比较咨询
const CMP_REF_RE = /(这|那)(两|2|二)(款|个|台)|它俩|这俩|前(两|2|二)(款|个|台)|第[一二两三四五六七八九\\d]+[个款]?和第?[一二两三四五六七八九\\d]+[个款]?|第(二|三|两)款/
const CMP_INDEX_RE = /第([一二两三四五六七八九\d]+)个?/g

function matchComparisonRef(text: string): { indices: [number, number] | null } | null {
  if (!CMP_REF_RE.test(text)) return null
  if (!/(哪|比|区别|差|对比|选|好)/.test(text)) return null
  const nums: number[] = []
  for (const m of text.matchAll(CMP_INDEX_RE)) {
    const d = m[1]
    const n = /[0-9]/.test(d) ? Number(d) : { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }[d] ?? null
    if (n) nums.push(n)
  }
  if (nums.length >= 2) return { indices: [nums[0], nums[1]] }
  return { indices: null }
}

function snapshotOf(ctx: SessionContext): string {
  const keys: SlotKey[] = ['categories', 'totalBudget', 'totalBudgetMin', 'itemBudget', 'itemBudgetRange', 'itemBudgetByCategory', 'familySize', 'houseArea', 'roomArea', 'installationDimensions', 'location', 'preferences', 'localNeeds', 'purchaseTime']
  const view: Record<string, unknown> = {}
  for (const k of keys) {
    if (ctx.slots[k]) view[k] = ctx.slots[k]?.value
  }
  return JSON.stringify(view)
}

export function slotsInputFrom(ctx: SessionContext): SlotsInput {
  const s = ctx.slots
  const raws = [s.totalBudget?.raw, s.itemBudget?.raw, s.itemBudgetRange?.raw].filter(Boolean).join(' ')
  const prefRaw = s.preferences?.raw ?? ''
  const strictCue = /不能超过|不超过/.test(raws)
  const floatingCue = /左右|上下/.test(raws)
  const cheapCue = /越便宜越好|越低越好|价格最低/.test(raws + ' ' + prefRaw)
  return {
    categories: (s.categories?.value as string[] | undefined) ?? [],
    totalBudget: (() => { const v = s.totalBudget?.value as unknown; return typeof v === 'number' ? v : (v && typeof v === 'object' ? (v as { max?: number }).max : undefined) })(),
    totalBudgetRange: (() => { const v = s.totalBudget?.value as unknown; return v && typeof v === 'object' ? (v as { min?: number; max?: number }) : undefined })(),
    totalBudgetMin: s.totalBudgetMin?.value as number | undefined,
    budgetFloating: !strictCue && floatingCue,
    budgetStrict: strictCue,
    cheapPreference: cheapCue,
    itemBudget: s.itemBudget?.value as number | undefined,
    itemBudgetRange: s.itemBudgetRange?.value as { min: number; max: number } | undefined,
    itemBudgetByCategory: s.itemBudgetByCategory?.value as Record<string, number> | undefined,
    familySize: s.familySize?.value as number | undefined,
    familySizeMin: s.familySizeMin?.value as number | undefined,
    houseArea: s.houseArea?.value as number | undefined,
    roomArea: s.roomArea?.value as number | undefined,
    installationDimensions: (s.installationDimensions?.value as SlotsInput['installationDimensions']) ?? [],
    location: s.location?.value as string | undefined,
    preferences: (s.preferences?.value as string[] | undefined) ?? [],
    localNeeds: (s.localNeeds?.value as string[] | undefined) ?? [],
    purchaseTime: s.purchaseTime?.value as string | undefined
  }
}

export class Advisor {
  private store: SessionStore

  constructor(store: SessionStore) {
    this.store = store
  }

  getContext(): SessionContext | null {
    return this.store.load()
  }

  ensureContext(): SessionContext {
    return this.store.load() ?? createSessionContext()
  }

  resetSession(): SessionContext {
    this.store.clear()
    const fresh = createSessionContext()
    this.store.save(fresh)
    return fresh
  }

  removeSlot(key: SlotKey): SessionContext {
    const ctx = this.ensureContext()
    if (ctx.slots[key]) {
      delete ctx.slots[key]
      logChange(ctx, { action: 'delete-slot', key, detail: '用户手动删除该条件' }, ctx.turnCount)
      this.store.save(ctx)
    }
    return ctx
  }

  processMessage(rawText: string, faqs: Faq[] = [], compareItems: Product[] = []): EngineResponse {
    const text = rawText.trim()
    const ctx = this.ensureContext()
    const turn = ctx.turnCount + 1

    // ===== SafetyGuard：独立于普通意图置信度的前置拦截 =====
    const safety = detectSafety(text)
    if (safety.safetyLevel === 'emergency') {
      const categoryText = safety.affectedCategory ?? ''
      const reply = safetyAlertText(safety, categoryText)
      ctx.turnCount = turn
      ctx.currentIntent = 'after_sale'
      ctx.intentHistory.push({ intent: 'after_sale', turn, confidence: 1 })
      ctx.stage = 'safety'
      ctx.dialogueState = 'safety'
      ctx.recentMessages.push({ role: 'user', text: text.slice(0, 120), turn, at: Date.now() })
      ctx.recentMessages.push({ role: 'assistant', text: reply.slice(0, 400), turn, at: Date.now() })
      this.store.save(ctx)
      return {
        reply,
        intent: {
          primaryIntent: 'after_sale',
          confidence: 1,
          matchedSignals: safety.matchedSignals.map((w) => ({ word: w, intent: 'after_sale' as const, weight: 1, type: 'context' as const })),
          alternativeIntent: null,
          needsClarification: false,
          clarificationQuestion: '',
          processingTimeMs: 0
        },
        quickOptions: [],
        followupQuestions: [],
        followupTargets: [],
        ready: false,
        stage: 'safety',
        slotChanges: [],
        safety
      }
    }

    // ===== PendingStateResolver：上一轮等待确认/选择时，短回答优先结合上下文解释 =====
    let pendingSlotForAnswer: SlotKey | null = ctx.pendingAsk?.slot ?? null
    if (!pendingSlotForAnswer && ctx.complaint && resolvePendingAnswer(text, 'contactWillingness')) {
      pendingSlotForAnswer = 'contactWillingness'
    }
    if (pendingSlotForAnswer) {
      const answer = resolvePendingAnswer(text, pendingSlotForAnswer)
      if (answer) {
        const consumed = this.applyPendingAnswer(text, ctx, turn, pendingSlotForAnswer, answer, safety)
        if (consumed) return consumed
      }
    }

    // ===== 比较指代解析：候选上下文优先于意图分类 =====
    const CMP_ATTR_RE = /(更?安静|更?静音|更?省电|更?节能|电费低|口之家|贵的那款|便宜的那款|最便宜|差在哪|不比较第|换成下一款|换成另一款)/
    const cmpRef = CMP_ATTR_RE.test(text) && compareItems.length > 0 ? { indices: null } : matchComparisonRef(text)
    if (cmpRef) {
      const cmpResp = this.handleComparisonRef(text, ctx, turn, cmpRef, safety, compareItems)
      if (cmpResp) return cmpResp
    }

    // ===== 显式模拟工单请求 =====
    if (/创建模拟工单|生成模拟工单|开个?模拟工单/.test(text)) {
      const ticketId = nextTicketId()
      const record: ComplaintRecord = { ticketId, topic: '售后维修（模拟）', preference: '上门检测维修', consent: true, createdAt: Date.now(), status: '待处理（演示）' }
      ctx.complaint = record
      ctx.turnCount = turn
      ctx.slots.contactIntent = { value: `已登记（${ticketId}）`, turn, raw: sanitizeRaw(text).slice(0, 80) }
      const entry: ChangeLogEntry = { turn, action: 'add-item', key: 'contactIntent', detail: `已创建模拟售后工单 ${ticketId}` }
      ctx.changeLog.push(entry)
      getAppLeadsStore().createAfterSalesCase({ sessionId: ctx.sessionId, category: (ctx.slots.categories?.value as string[] | undefined)?.[0] ?? '家电', faults: (ctx.slots.faultSymptoms?.value as string[] | undefined) ?? [], tried: true, resolved: false, expectation: '上门检测维修（模拟流程）' })
      const reply = `已为你生成模拟售后工单 ${ticketId}。诉求为“上门检测维修”，当前状态为“待处理（演示）”。该记录仅保存在当前浏览器，不会提交给真实企业，可在“线索管理”中查看。`
      ctx.stage = 'resolved'
      ctx.dialogueState = 'followup_accepted'
      ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
      ctx.recentMessages.push({ role: 'assistant', text: reply.slice(0, 400), turn, at: Date.now() })
      this.store.save(ctx)
      return {
        reply,
        intent: { primaryIntent: 'after_sale', confidence: 0.9, matchedSignals: [{ word: '模拟工单', intent: 'after_sale', weight: 1, type: 'context' }], alternativeIntent: null, needsClarification: false, clarificationQuestion: '', processingTimeMs: 0 },
        quickOptions: [],
        followupQuestions: [],
        followupTargets: [],
        ready: false,
        stage: 'resolved',
        dialogueState: 'followup_accepted',
        slotChanges: [entry],
        safety: undefined,
        kb: undefined
      }
    }

    const intent = recognizeIntent(text, ctx)
    const an = getAppAnalyticsStore()
    an.track('user_message_sent', { sessionId: ctx.sessionId, processingTimeMs: intent.processingTimeMs })
    an.track(intent.needsClarification ? 'intent_clarified' : 'intent_detected', { sessionId: ctx.sessionId, intent: intent.needsClarification ? undefined : intent.primaryIntent, processingTimeMs: intent.processingTimeMs })
    if (safety.safetyLevel !== 'none') an.track('safety_guard_triggered', { sessionId: ctx.sessionId, payload: { level: safety.safetyLevel } })
    const updates = extractSlots(text, ctx, intent, turn)
    let kbInfo: EngineResponse['kb'] | undefined
    let safetyCaution = ''
    if (safety.safetyLevel === 'caution') {
      safetyCaution = safetyCautionText(safety)
    }

    const prevPending = ctx.pendingAsk
    // 高危故障：本轮命中或历史故障中含高危项，均按安全优先处理
    let pendingWidth = false
    let highRisk = HIGH_RISK_FAULT.test(text)
    const faultsNow = (ctx.slots.faultSymptoms?.value as string[] | undefined) ?? []
    if (faultsNow.some((f) => ['漏电', '跳闸', '冒烟', '烧焦味'].includes(f))) highRisk = true
    const changes: ChangeLogEntry[] = []

    for (const u of updates) {
      if (isPseudoKey(u.key)) {
        if (u.key === ('__pendingWidth' as SlotKey)) pendingWidth = true
        if (u.key === ('__highRisk' as SlotKey)) highRisk = true
        continue
      }
      const before = ctx.slots[u.key]?.value
      let value = u.value
      if (u.key === 'itemBudgetByCategory' && u.mode === 'merge') {
        value = { ...((before as Record<string, number>) ?? {}), ...(u.value as Record<string, number>) }
      }
      const sv: SlotValue<unknown> = { value, turn, raw: sanitizeRaw(text).slice(0, 80) }
      if (u.mode === 'delete-slot') delete ctx.slots[u.key]
      else ctx.slots[u.key] = sv
      const entry: ChangeLogEntry = { turn, action: u.mode === 'merge' ? 'add-item' : u.mode, key: u.key, detail: u.detail }
      ctx.changeLog.push(entry)
      changes.push(entry)
    }

    // 知识库解决确认承接
    if (prevPending?.slot === ('kbResolution' as SlotKey) && updates.every((u) => u.key !== 'kbResolution')) {
      const resolved = /已解决|解决了|好了|解决啦/.test(text)
      const unresolved = /未解决|没解决|还是不行|还是不行|不行|没有解决/.test(text)
      if (resolved || unresolved) {
        const detail = resolved ? '用户确认问题已解决' : '用户反馈未解决，可创建模拟售后工单（演示流程，不收集联系方式）'
        ctx.changeLog.push({ turn, action: 'update', key: 'complaintResolution', detail })
        changes.push({ turn, action: 'update', key: 'complaintResolution', detail })
      }
    }

    // 判定为 clarification 时不推进业务状态，仅记录消息
    ctx.turnCount = turn
    ctx.currentIntent = intent.needsClarification ? ctx.currentIntent : intent.primaryIntent
    if (!intent.needsClarification) {
      ctx.intentHistory.push({ intent: intent.primaryIntent, turn, confidence: intent.confidence })
    }

    ctx.pendingAsk = null

    ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })

    let followups: FollowupQuestion[] = []
    let reply = ''
    let stage: SessionContext['stage'] = 'slot_filling'
    let dialogueState: DialogueState = (ctx.dialogueState ?? 'idle') as DialogueState
    let leadConsentMain: EngineResponse['leadConsent'] = undefined
    let quickOptions: string[] = []

    if (intent.needsClarification && changes.length === 0) {
      stage = 'clarify'
      reply = intent.clarificationQuestion
      quickOptions = CHITCHAT_DIRECTIONS
    } else {
      followups = computeFollowups(ctx, text, highRisk, pendingWidth, prevPending?.slot ?? null)
      const st = readyState(ctx)
      const ready = ctx.currentIntent === 'pre_sale' && st.ready && followups.length === 0

      // ===== 购买意向识别与授权询问（拒绝后不再主动询问） =====
      let leadOverride: string | null = null
      const pendingConsent = prevPending?.slot === ('leadConsent' as SlotKey)
      const leads = getAppLeadsStore()
      const pIntent = detectPurchaseIntent(text, pendingConsent)
      if (ctx.currentIntent === 'purchase_intent' && pIntent === 'buy' && (ctx.askCounts.leadConsent ?? 0) < 2 && !ctx.slots.contactIntent) {
          const score = scorePurchaseLead(ctx, { explicitBuy: EXPLICIT_BUY_RE.test(text), commerceAsk: COMMERCE_ASK_RE.test(text), consentGiven: false })
          leads.auditEvent(leads.role.current, 'lead_score_updated', ctx.sessionId, 'success', `意向评分 ${score.total} 分（${score.level}）：${score.items.map((i) => `${i.label}+${i.score}`).join('、') || '暂无得分项'}`)
          leads.auditEvent(leads.role.current, 'lead_consent_requested', ctx.sessionId, 'success', '询问是否进入联系信息填写流程（展示用途/字段/保存位置/模拟性质）')
          getAppAnalyticsStore().track('lead_consent_requested', { sessionId: ctx.sessionId })
          const items = score.items.map((i) => `${i.label} +${i.score}（${i.basis}）`).join('；') || '暂无得分项'
          leadOverride = `已识别购买意向，当前意向评分 ${score.total} 分（${score.level}）。依据：${items}。\n如需生成演示线索，我可以为你登记模拟联系记录：${CONSENT_PURPOSE_TEXT}\n是否同意进入联系信息填写流程？（同意后才会显示独立表单）`
          followups = [{ target: 'leadConsent' as SlotKey, question: '是否同意进入联系信息填写流程？', options: ['同意', '暂不'] }]
          ctx.pendingAsk = { slot: 'leadConsent', turn }
          ctx.askCounts.leadConsent = (ctx.askCounts.leadConsent ?? 0) + 1
          ctx.askCounts.contactWillingness = 99
          quickOptions = ['同意', '暂不']
          stage = 'slot_filling'
          leadConsentMain = 'purchase'
      }
      if (pIntent === 'decline' && (ctx.askCounts.leadConsent ?? 0) < 2) {
        leads.auditEvent(leads.role.current, 'lead_consent_declined', ctx.sessionId, 'denied', '用户表示暂不考虑/先别联系：不显示表单、不创建记录、不再主动询问')
        ctx.askCounts.leadConsent = 99
        ctx.askCounts.contactWillingness = 99
        leadOverride = '好的，先不打扰你。之后的进度和对比都保留在这里，想继续时告诉我即可。'
      }
      if (pIntent === 'cancel') {
        for (const r of leads.bySession(ctx.sessionId)) leads.withdrawConsent(r.id, leads.role.current)
        leadOverride = '已为你撤回授权并删除完整联系方式，仅保留非敏感业务摘要。如需彻底删除记录，可前往“线索管理”操作。'
      }

      const ackParts: string[] = []
      if (ctx.currentIntent === 'after_sale' && highRisk) {
        ackParts.push('【安全提示】这种情况请先停止使用并断电（或关闭燃气阀门），不要自行拆机，建议尽快让专业人员上门检测。')
      }
      if (changes.length > 0) {
        const prefix = changes.some((c) => c.action === 'update') ? '明白，' : '好的，'
        ackParts.push(prefix + changes.map((c) => c.detail).join('；') + '。')
      }

      let tail = ''
      let kbNote = ''
      if (ctx.currentIntent === 'after_sale' && faqs.length > 0 && !highRisk) {
        const cat = (ctx.slots.categories?.value as string[] | undefined ?? [])[0] ?? null
        const kb = searchFaq(text, faqs, { category: cat, safetyBoost: safety.safetyLevel === 'caution' })
        if (kb.confidence === 'high') {
          kbInfo = { matchedFaqId: kb.matchedFaqId, confidence: kb.confidence, sourceLabel: kb.sourceLabel }
          getAppAnalyticsStore().track('faq_matched', { sessionId: ctx.sessionId, recordId: kb.matchedFaqId ?? undefined })
          const isInfoQuestion = /保修|包修|保养|清洗|多久|怎么清洗|怎么判断/.test(text) && !/不制冷|不脱水|漏水|漏电|不进水|花屏|没反应/.test(text)
          if (isInfoQuestion) {
            kbNote = `${kb.answer}\n（${kb.sourceLabel}）`
            stage = 'resolved'
          } else {
            kbNote = `${kb.answer}\n（${kb.sourceLabel}）`
            ctx.pendingAsk = { slot: 'kbResolution', turn }
            ctx.askCounts.kbResolution = (ctx.askCounts.kbResolution ?? 0) + 1
            ctx.askCounts.faultDuration = 2
            quickOptions = ['已解决', '未解决']
            followups = [{ target: 'kbResolution' as SlotKey, question: '请问按以上步骤操作后问题解决了吗？', options: ['已解决', '未解决'] }]
            stage = 'slot_filling'
          }
        } else if (kb.confidence === 'medium') {
          kbInfo = { matchedFaqId: null, confidence: kb.confidence, sourceLabel: '模拟知识库' }
          kbNote = `知识库中找到几个可能相关的问题，你可以点选确认：`
          quickOptions = kb.alternativeFaqs.map((x) => x.question)
          followups = []
        } else if (prevPending?.slot !== ('kbResolution' as SlotKey)) {
          kbNote = '知识库暂未找到可靠答案，我会按售后流程为你记录。'
        }
      }
      if (leadOverride) {
        tail = leadOverride
        stage = 'slot_filling'
        dialogueState = 'awaiting_followup_consent'
      } else if (pendingWidth) {
        tail = followups.map((f) => f.question).join('')
      } else if (ready) {
        stage = 'ready'
        tail = buildReadyReply(ctx) + (st.notes.length > 0 ? `${st.notes[0]}。` : '')
      } else if (followups.length > 0) {
        tail = followups.map((f) => f.question).join('')
        stage = 'slot_filling'
      } else {
        stage = ctx.currentIntent === 'complaint' ? 'resolved' : 'slot_filling'
        tail = defaultStatement(ctx.currentIntent ?? 'chitchat_unknown', text)
      }
      // 对话状态映射（每条消息最多一次迁移）
      if (ctx.currentIntent === 'complaint') {
        const cr = Boolean(ctx.slots.complaintResolution)
        const ci = Boolean(ctx.slots.contactIntent)
        if (ctx.complaint) dialogueState = 'followup_accepted'
        else if (ci) dialogueState = 'followup_declined'
        else if (cr) dialogueState = 'awaiting_followup_consent'
        else dialogueState = 'awaiting_complaint_detail'
      } else if (followups.length > 0) {
        const t0 = followups[0].target
        dialogueState = (t0 === ('budget' as SlotKey) ? 'awaiting_budget'
          : t0 === 'categories' ? 'awaiting_category'
          : t0 === ('contactWillingness' as SlotKey) ? 'awaiting_followup_consent'
          : t0 === ('complaintResolution' as SlotKey) ? 'awaiting_resolution_preference'
          : t0 === ('faultSymptoms' as SlotKey) ? 'awaiting_complaint_detail'
          : t0 === ('kbResolution' as SlotKey) ? 'awaiting_kb_resolution'
          : t0 === ('preferences' as SlotKey) ? 'awaiting_preferences'
          : 'idle') as DialogueState
      } else if (ready) {
        dialogueState = 'ready_for_recommendation'
      }
      reply = `${ackParts.join('')}${kbNote ? kbNote + '\n' : ''}${tail}`
      if (safety.safetyLevel === 'caution') reply = `${safetyCaution}${reply}`
      if (/未解决|还是不行/.test(text) && ctx.currentIntent === 'after_sale') {
        reply = `${reply}\n如问题仍未解决，可以为你创建模拟售后工单（演示流程，不收集联系方式）。`
      }
      quickOptions = followups[0]?.options ?? []

      // 登记本轮追问目标，避免重复追问
      for (const f of followups) {
        ctx.askCounts[f.target] = (ctx.askCounts[f.target] ?? 0) + 1
      }
      if (followups.length > 0) {
        ctx.pendingAsk = { slot: followups[0].target, turn }
      }
      if (ready) stage = 'ready'
    }

    if (ctx.recommendations) {
      const prevSnapshot = ctx.recommendations.snapshot
      ctx.recommendations.snapshot = snapshotOf(ctx)
      if (ctx.recommendations.snapshot !== prevSnapshot) {
        ctx.recommendations.stale = true
        logChange(ctx, { action: 'update', key: 'categories', detail: '需求条件已变化，原推荐结果标记为待重新生成' }, turn)
      }
    }
    ctx.stage = stage
    ctx.dialogueState = dialogueState
    ctx.recentMessages.push({ role: 'assistant', text: reply.slice(0, 400), turn, at: Date.now() })
    this.store.save(ctx)
    return {
      reply,
      intent,
      quickOptions,
      followupQuestions: followups.map((f) => f.question),
      followupTargets: followups.map((f) => f.target),
      ready: stage === 'ready',
      stage,
      dialogueState,
      slotChanges: changes,
      leadConsent: leadConsentMain,
      safety: safety.safetyLevel !== 'none' ? safety : undefined,
      kb: kbInfo
    }
  }

  // ===== PendingStateResolver 的执行：消费一次确认/选择，生成与状态一致的回复 =====
  private applyPendingAnswer(
    text: string,
    ctx: SessionContext,
    turn: number,
    slot: SlotKey,
    answer: PendingAnswer,
    safety: ReturnType<typeof detectSafety>
  ): EngineResponse | null {
    const isBoolean = ['contactWillingness', 'kbResolution', 'safetyConfirmed'].includes(slot)
    if (!isBoolean && answer.kind !== 'option') return null
    ctx.pendingAsk = null
    ctx.turnCount = turn
    ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
    ctx.askCounts[slot] = 99
    const changes: ChangeLogEntry[] = []
    let reply = ''
    let stage: SessionContext['stage'] = 'resolved'
    let dialogueState: DialogueState = 'idle'
    let quickOptions: string[] = []
    let followups: FollowupQuestion[] = []
    let leadConsentFlag: EngineResponse['leadConsent'] = undefined

    if (slot === ('contactWillingness' as SlotKey)) {
      if (answer.kind === 'affirm') {
        if (ctx.complaint) {
          reply = `已收到你的确认。模拟投诉记录 ${ctx.complaint.ticketId} 已存在，不会重复创建；当前状态为“${ctx.complaint.status}”。`
        } else {
          const topic = (ctx.slots.complaintTopic?.value as string) ?? '家电配送/售后问题'
          const preference = (ctx.slots.complaintResolution?.value as string) ?? '待沟通确认'
          const ticketId = nextTicketId()
          const record: ComplaintRecord = { ticketId, topic, preference, consent: true, createdAt: Date.now(), status: '待处理（演示）' }
          ctx.complaint = record
          ctx.slots.contactIntent = { value: `同意登记（${ticketId}）`, turn, raw: sanitizeRaw(text).slice(0, 80) }
          const entry: ChangeLogEntry = { turn, action: 'add-item', key: 'contactIntent', detail: `已创建模拟投诉记录 ${ticketId}` }
          ctx.changeLog.push(entry)
          changes.push(entry)
          if (!ctx.complaintMigrated) {
            const leads = getAppLeadsStore()
            leads.migrateComplaint(ctx.sessionId, { ticketId, topic, preference })
            ctx.complaintMigrated = true
          }
          reply = `已为你生成模拟投诉记录 ${ticketId}。诉求为“${preference}”，当前状态为“待处理（演示）”。该记录仅保存在当前浏览器，不会提交给真实企业。`
        }
        dialogueState = 'followup_accepted'
      } else {
        ctx.slots.contactIntent = { value: '暂不需要', turn, raw: sanitizeRaw(text).slice(0, 80) }
        const entry: ChangeLogEntry = { turn, action: 'update', key: 'contactIntent', detail: '已记录本次暂不登记演示记录' }
        ctx.changeLog.push(entry)
        changes.push(entry)
        reply = '好的，本次暂不登记演示记录，也不会有任何人联系你。如后续需要帮助，随时告诉我。'
        dialogueState = 'followup_declined'
      }
    } else if (slot === ('kbResolution' as SlotKey)) {
      const resolved = answer.kind === 'affirm'
      getAppAnalyticsStore().track(resolved ? 'faq_resolved' : 'faq_unresolved', { sessionId: ctx.sessionId })
      const entry: ChangeLogEntry = { turn, action: 'update', key: 'kbResolution', detail: resolved ? '用户确认问题已解决' : '用户反馈未解决，可创建模拟售后工单（演示流程，不收集联系方式）' }
      ctx.changeLog.push(entry)
      changes.push(entry)
      if (resolved) {
        reply = '太好了，问题已解决。如果后续再遇到使用问题，随时来问我。'
      } else {
        reply = '收到，问题还未解决。你可以继续描述细节，我会一并记录；也可以说“创建模拟工单”，我会生成一条演示工单（不收集联系方式）。'
        quickOptions = ['创建模拟工单']
        ctx.pendingAsk = { slot: 'kbResolution', turn }
      }
      dialogueState = resolved ? 'followup_accepted' : 'awaiting_kb_resolution'
      stage = resolved ? 'resolved' : 'slot_filling'
    } else if (slot === ('safetyConfirmed' as SlotKey)) {
      if (answer.kind === 'option' && answer.option === '__invalid__') {
        // 短回答对“是否已断电”无意义：继续澄清，不迁移状态
        ctx.pendingAsk = { slot, turn }
        reply = PENDING_QUESTIONS.safetyConfirmed ?? '为确保安全，请问您已经断电或关闭燃气阀门了吗？'
        stage = 'slot_filling'
        dialogueState = 'safety'
        ctx.askCounts[slot] = (ctx.askCounts[slot] ?? 99) - 98
      } else if (answer.kind === 'affirm') {
        const entry: ChangeLogEntry = { turn, action: 'update', key: 'safetyConfirmed', detail: '用户确认已断电/关闭阀门' }
        ctx.changeLog.push(entry)
        changes.push(entry)
        reply = '好的，请保持断电或阀门关闭状态，不要自行拆机，等待专业人员检测。'
        dialogueState = 'idle'
      } else {
        const entry: ChangeLogEntry = { turn, action: 'update', key: 'safetyConfirmed', detail: '用户尚未断电/关阀' }
        ctx.changeLog.push(entry)
        changes.push(entry)
        reply = '明白，请现在立即断电（或关闭燃气阀门），先保证安全，稍后再继续咨询。'
        dialogueState = 'safety'
      }
    } else if (slot === ('leadConsent' as SlotKey)) {
      ctx.turnCount = turn
      ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
      ctx.askCounts.leadConsent = 99
      const leads = getAppLeadsStore()
      if (answer.kind === 'affirm') {
        ctx.slots.contactIntent = { value: '同意进入联系信息填写（未填写前不收集）', turn, raw: sanitizeRaw(text).slice(0, 80) }
        leads.auditEvent(leads.role.current, 'lead_consent_granted', ctx.sessionId, 'success', '用户同意进入联系方式填写流程（独立表单，未默认勾选）')
        getAppAnalyticsStore().track('lead_consent_granted', { sessionId: ctx.sessionId })
        reply = '好的。请在下方弹出的独立表单中填写联系方式（手机号为必填，建议使用模拟号码），勾选授权后提交即可生成模拟线索卡片。'
        leadConsentFlag = 'purchase'
        stage = 'resolved'
        dialogueState = 'followup_accepted'
      } else {
        leads.auditEvent(leads.role.current, 'lead_consent_declined', ctx.sessionId, 'denied', '用户拒绝进入联系流程：不显示表单、不创建含联系方式的记录')
        getAppAnalyticsStore().track('lead_consent_declined', { sessionId: ctx.sessionId })
        reply = '好的，本次不生成联系记录，也不会再主动询问。需要时随时告诉我。'
        stage = 'resolved'
        dialogueState = 'followup_declined'
      }
      const entry: ChangeLogEntry = { turn, action: 'update', key: 'contactIntent', detail: answer.kind === 'affirm' ? '用户同意进入联系信息填写流程' : '用户拒绝进入联系流程' }
      ctx.changeLog.push(entry)
      changes.push(entry)
    } else if (slot === ('preferences' as SlotKey) && answer.pref) {
      const cur = ((ctx.slots.preferences?.value as string[] | undefined) ?? []).slice()
      const next = cur.filter((k) => !answer.pref!.remove.includes(k as never))
      for (const k of answer.pref.add) if (!next.includes(k)) next.push(k)
      if (next.length > 0) ctx.slots.preferences = { value: next, turn, raw: sanitizeRaw(text).slice(0, 80) }
      else delete ctx.slots.preferences
      const entry: ChangeLogEntry = { turn, action: 'update', key: 'preferences', detail: answer.pref.none ? '已记录：没有特别偏好' : `偏好已更新：${next.map(prefLabel).join('、') || '无'}` }
      ctx.changeLog.push(entry)
      changes.push(entry)
      const cats = (ctx.slots.categories?.value as string[] | undefined) ?? []
      const fam = ctx.slots.familySize?.value as number | undefined
      const famMin = ctx.slots.familySizeMin?.value as number | undefined
      const budgetText = formatBudget(budgetFromSlots(ctx.slots as never))
      const summaryBits = [
        cats.length ? cats.join('、') : '',
        budgetText !== '未设置预算' ? `预算 ${budgetText}` : '',
        fam ? familyPhrase(fam) : famMin ? `${famMin}人以上` : '',
        next.length ? `偏好${next.map(prefLabel).join('、')}` : ''
      ].filter(Boolean)
      followups = computeFollowups(ctx, text, false, false, null)
      for (const f of followups) ctx.askCounts[f.target] = (ctx.askCounts[f.target] ?? 0) + 1
      if (followups.length > 0) ctx.pendingAsk = { slot: followups[0].target, turn }
      const ready = isReadyForRecommend(ctx)
      reply = answer.pref.none
        ? `好的，那就不设特别偏好，按综合表现挑选。当前需求：${summaryBits.join('｜') || '（待补充）'}。`
        : `好的，已将${answer.pref.add.map(prefLabel).join('、') || '该偏好'}作为优先考虑条件。当前需求：${summaryBits.join('｜') || '（待补充）'}。`
      if (ready) reply += '需求已完整，可以生成推荐方案。'
      quickOptions = followups[0]?.options ?? []
      stage = ready ? 'ready' : 'slot_filling'
      dialogueState = ready ? 'ready_for_recommendation' : followups[0]?.target === ('budget' as SlotKey) ? 'awaiting_budget' : 'idle'
    } else if (answer.kind === 'option' && answer.option) {
      ctx.slots[slot] = { value: answer.option, turn, raw: sanitizeRaw(text).slice(0, 80) }
      const entry: ChangeLogEntry = { turn, action: 'set', key: slot, detail: `已记录：${answer.option}` }
      ctx.changeLog.push(entry)
      changes.push(entry)
      followups = computeFollowups(ctx, text, false, false, null)
      for (const f of followups) ctx.askCounts[f.target] = (ctx.askCounts[f.target] ?? 0) + 1
      if (followups.length > 0) ctx.pendingAsk = { slot: followups[0].target, turn }
      reply = `好的，已记录：${answer.option}。${followups.map((f) => f.question).join('')}`
      quickOptions = followups[0]?.options ?? []
      stage = 'slot_filling'
      const t0 = followups[0]?.target
      dialogueState = t0 === ('contactWillingness' as SlotKey) ? 'awaiting_followup_consent'
        : t0 === ('budget' as SlotKey) ? 'awaiting_budget'
        : t0 === 'categories' ? 'awaiting_category'
        : t0 === ('complaintResolution' as SlotKey) ? 'awaiting_resolution_preference'
        : t0 === ('faultSymptoms' as SlotKey) ? 'awaiting_complaint_detail'
        : 'idle'
      if (!followups.length) stage = ctx.currentIntent === 'complaint' ? 'resolved' : 'slot_filling'
    }

    if (safety.safetyLevel === 'caution') reply = `${safetyCautionText(safety)}${reply}`
    ctx.stage = stage
    ctx.dialogueState = dialogueState
    ctx.recentMessages.push({ role: 'assistant', text: reply.slice(0, 400), turn, at: Date.now() })
    this.store.save(ctx)
    return {
      reply,
      intent: {
        primaryIntent: ctx.currentIntent ?? 'chitchat_unknown',
        confidence: 0.9,
        matchedSignals: [{ word: `上下文确认(${slot})`, intent: (ctx.currentIntent ?? 'chitchat_unknown') as IntentKey, weight: 1, type: 'context' }],
        alternativeIntent: null,
        needsClarification: false,
        clarificationQuestion: '',
        processingTimeMs: 0
      },
      quickOptions,
      followupQuestions: followups.map((f) => f.question),
      followupTargets: followups.map((f) => f.target),
      ready: false,
      stage,
      dialogueState,
      slotChanges: changes,
      leadConsent: leadConsentFlag,
      safety: safety.safetyLevel !== 'none' ? safety : undefined,
      kb: undefined
    }
  }

  // ===== 比较指代处理：基于现有候选上下文，缺少对象时明确指出 =====
  private handleComparisonRef(
    text: string,
    ctx: SessionContext,
    turn: number,
    cmpRef: { indices: [number, number] | null },
    safety: ReturnType<typeof detectSafety>,
    compareItems: Product[]
  ): EngineResponse | null {
    const hasFullSpecs = compareItems.length > 0
    const list = (hasFullSpecs
      ? compareItems
      : (ctx.recommendations?.candidateInfo ?? []).map((c) => ({ id: c.id, name: c.name, brand: '', category: c.category, price: c.price }))) as Product[]
    const recCards = ctx.recommendations ? Object.values(ctx.recommendations.cards).flat() : []
    const idxOf = (raw: string): number => {
      const n = /[0-9]/.test(raw) ? Number(raw) : ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[raw] ?? 0
      return n
    }
    const noiseOf = (p: Product): number | null => {
      const n = (p as Product & { noiseDb: { standard: number } | number | null }).noiseDb
      if (n === null || n === undefined) return null
      return typeof n === 'number' ? n : n.standard
    }
    const energyRank = (p: Product): number => {
      const g = String((p as Product & { energyGrade: string }).energyGrade ?? '')
      const m = g.match(/([一二三四五])/)
      return m ? 6 - ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 } as Record<string, number>)[m[1]]! : 0
    }
    const rankText = (p: Product): string => String((p as Product & { energyGrade: string }).energyGrade ?? '暂无数据')
    const finish = (reply: string, stageArg: SessionContext['stage'], stateArg: DialogueState, action?: EngineResponse['compareAction'], opts: { quickOptions?: string[] } = {}): EngineResponse => {
      if (safety.safetyLevel === 'caution') reply = `${safetyCautionText(safety)}${reply}`
      ctx.stage = stageArg
      ctx.dialogueState = stateArg
      ctx.recentMessages.push({ role: 'assistant', text: reply.slice(0, 400), turn, at: Date.now() })
      this.store.save(ctx)
      return {
        reply,
        intent: { primaryIntent: 'comparison', confidence: 0.85, matchedSignals: [{ word: '比较指代', intent: 'comparison', weight: 1, type: 'context' }], alternativeIntent: null, needsClarification: false, clarificationQuestion: '', processingTimeMs: 0 },
        quickOptions: opts.quickOptions ?? [],
        followupQuestions: [],
        followupTargets: [],
        ready: false,
        stage: stageArg,
        dialogueState: stateArg,
        slotChanges: [],
        safety: safety.safetyLevel !== 'none' ? safety : undefined,
        kb: undefined,
        compareAction: action
      }
    }

    // 移除指令
    const removeM = text.match(/(?:不比较|去掉|移除|删除)第([一二三四五六\d]+)款?/)
    if (removeM) {
      ctx.turnCount = turn
      ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
      const n = idxOf(removeM[1])
      if (list.length === 0) return finish('当前还没有对比商品，无需移除。', 'resolved', 'idle')
      if (n >= 1 && n <= list.length) {
        const item = list[n - 1]
        return finish(`好的，已从对比移除：${item.name}。当前对比列表还有 ${list.length - 1} 款。`, 'resolved', 'idle', { type: 'remove', productId: item.id })
      }
      return finish(`当前对比列表里只有 ${list.length} 款，无法移除第${n}款。`, 'slot_filling', 'awaiting_comparison_targets')
    }

    // 替换指令
    const replaceM = text.match(/把第([一二三四五六\d]+)款?换成(下一款|另一款|别的款?)/)
    if (replaceM && recCards.length > 0) {
      ctx.turnCount = turn
      ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
      const n = idxOf(replaceM[1])
      const inCompare = new Set(list.map((i) => i.id))
      const target = recCards.find((c) => !inCompare.has(c.productId))
      if (list.length === 0) return finish('当前还没有对比商品，可以先在推荐结果或商品库中加入对比。', 'slot_filling', 'awaiting_comparison_targets')
      if (n < 1 || n > list.length) return finish(`当前对比列表里只有 ${list.length} 款，无法替换第${n}款。`, 'slot_filling', 'awaiting_comparison_targets')
      if (!target) return finish('推荐结果里暂时没有可替换的新商品，可以先换一批推荐再试。', 'resolved', 'idle')
      return finish(`好的，已把对比列表第${n}款（${list[n - 1].name}）替换为推荐中的：${target.name}（${target.price} 元）。`, 'resolved', 'idle', { type: 'replace', productId: target.productId, index: n - 1 })
    }

    // 索引指代但无对比列表与推荐卡片：交回意图管线
    if (cmpRef.indices && list.length < 2 && recCards.length < 2) return null

    ctx.turnCount = turn
    ctx.recentMessages.push({ role: 'user', text: sanitizeRaw(text).slice(0, 120), turn, at: Date.now() })
    if (list.length === 0) {
      return finish('当前还没有选定需要比较的商品。你可以：1) 在推荐结果中点“加入对比”；2) 前往商品库页面加入对比；3) 直接告诉我两个商品名称或编号。', 'slot_filling', 'awaiting_comparison_targets')
    }
    if (list.length === 1) {
      return finish(`还需要至少再选择 1 款商品才能比较。目前对比列表中是：${list[0].name}。`, 'slot_filling', 'awaiting_comparison_targets')
    }

    // 属性型问题
    if (/安静|静音|噪声|噪音/.test(text)) {
      const rated = list.map((p) => ({ p, n: noiseOf(p) })).filter((x) => x.n !== null)
      if (rated.length > 0) {
        const best = rated.reduce((a, b) => (a.n! <= b.n! ? a : b))
        const others = rated.filter((x) => x !== best).map((x) => `${x.p.name} ${x.n}dB`).join('、')
        return finish(`对比列表里更安静的是：${best.p.name}，运行噪声约 ${best.n} dB；其余为 ${others}。需要逐项参数对比，可以进入“商品对比”页查看。`, 'resolved', 'idle')
      }
      return finish('对比列表里的商品暂无噪声数据。', 'resolved', 'idle')
    }
    if (/省电|节能|电费/.test(text)) {
      const best = list.reduce((a, b) => (energyRank(a) >= energyRank(b) ? a : b))
      const same = list.every((p) => energyRank(p) === energyRank(best))
      if (same) return finish(`对比列表里各款能效相同（${rankText(best)}），节能表现接近，建议结合价格与容量选择。`, 'resolved', 'idle')
      return finish(`如果更重视节能，选 ${best.name}（能效 ${rankText(best)}）；其余为 ${list.filter((p) => p !== best).map((p) => `${p.name}（${rankText(p)}）`).join('、')}。`, 'resolved', 'idle')
    }
    if (/适合.{0,4}口之家|口人/.test(text)) {
      const famM = text.match(/([一二两三四五六\d]+)\s*口/)
      const fam = famM ? (/[0-9]/.test(famM[1]) ? Number(famM[1]) : ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[famM[1]] ?? 0) : 0
      const fits = list.filter((p) => {
        const f = (p as Product & { familySizeFit: [number, number] }).familySizeFit
        return Boolean(f && fam >= f[0] && fam <= f[1])
      })
      if (fam > 0 && fits.length > 0) return finish(`适合 ${fam} 口之家的有：${fits.map((p) => p.name).join('、')}。`, 'resolved', 'idle')
      if (fam > 0) return finish(`对比列表里的商品适用人数都无法覆盖 ${fam} 口人，可能需要看看更大规格的款式。`, 'resolved', 'idle')
      return finish(`对比列表的适用人数：${list.map((p) => { const f = (p as Product & { familySizeFit: [number, number] }).familySizeFit; return f ? `${p.name} ${f[0]}～${f[1]}口` : `${p.name} 暂无数据` }).join('；')}。`, 'resolved', 'idle')
    }
    if (/贵的那款|最贵/.test(text)) {
      const priciest = list.reduce((a, b) => (b.price > a.price ? b : a))
      const sp = (priciest as Product & { sellingPoints: string[] }).sellingPoints ?? []
      return finish(`最贵的是 ${priciest.name}（${priciest.price} 元）。它的优势：${sp.slice(0, 2).join('；') || '配置更高（模拟卖点）'}。`, 'resolved', 'idle')
    }
    if (/便宜的那款|最便宜|差在哪/.test(text)) {
      const cheapest = list.reduce((a, b) => (b.price < a.price ? b : a))
      const lim = (cheapest as Product & { limitations: string[] }).limitations ?? []
      const priciest = list.reduce((a, b) => (b.price > a.price ? b : a))
      return finish(`最便宜的是 ${cheapest.name}（${cheapest.price} 元，比 ${priciest.name} 便宜 ${priciest.price - cheapest.price} 元）。它相对不足的地方：${lim.slice(0, 2).join('；') || '配置相对基础（模拟口径）'}。`, 'resolved', 'idle')
    }

    // 成对比较
    let i = cmpRef.indices ? cmpRef.indices[0] - 1 : 0
    let j = cmpRef.indices ? cmpRef.indices[1] - 1 : 1
    if (cmpRef.indices && (cmpRef.indices[0] > list.length || cmpRef.indices[1] > list.length)) {
      return finish(`当前对比列表里只有 ${list.length} 款，无法比较第${Math.max(cmpRef.indices[0], cmpRef.indices[1])}款。可比较范围：${list.map((p, k) => `第${k + 1}款 ${p.name}`).join('；')}。`, 'slot_filling', 'awaiting_comparison_targets')
    }
    i = Math.min(Math.max(i, 0), list.length - 1)
    j = Math.min(Math.max(j, 0), list.length - 1)
    if (i === j) j = i === 0 ? 1 : i - 1
    const a = list[Math.min(i, j)]
    const b = list[Math.max(i, j)]
    const pair = [a, b]
    const input = slotsInputFrom(ctx)
    const hasNeeds = input.categories.length > 0 || Boolean(input.totalBudget || input.itemBudget || input.itemBudgetRange || input.totalBudgetMin) || Boolean(input.familySize || input.familySizeMin) || input.preferences.length > 0
    const diff = Math.abs(a.price - b.price)
    const cheaper = a.price <= b.price ? a : b
    const lines: string[] = []
    if (hasNeeds && hasFullSpecs) lines.push('按照你当前的需求进行比较：')
    lines.push(`1）${a.name}（${a.price} 元）`)
    lines.push(`2）${b.name}（${b.price} 元）`)
    if (hasNeeds && hasFullSpecs) {
      const scored = scoreForComparison(pair, input)
      const sorted = [...scored].sort((x, y) => y.card.totalScore - x.card.totalScore)
      const best = sorted[0]
      const other = sorted[1]
      lines.push(`在你当前条件下更匹配的是：${best.card.name}（匹配 ${best.card.totalScore} 分，${other.card.name} 为 ${other.card.totalScore} 分）。`)
      if (best.card.reasons.length > 0) lines.push(`推荐依据：${best.card.reasons.slice(0, 2).join('；')}。`)
      const caveat = other.card.caveats[0]
      if (caveat) lines.push(`需要注意的取舍：${caveat}。`)
      const pending = pair.find((p) => scored.find((x) => x.productId === p.id)?.card.sizeFitStatus === '尺寸待确认')
      if (pending) lines.push(`仍有条件待确认：${pending.name} 的安装尺寸。`)
    }
    lines.push(`价格相差 ${diff} 元，${cheaper.name} 更便宜；如果更重视价格可优先看 ${cheaper.name}。`)
    lines.push('需要逐项参数对比，可进入“商品对比”页查看。')
    return finish(lines.join('\n'), 'resolved', 'idle')
  }

  generateRecommendations(catalog: Product[], opts: { nextBatch?: boolean } = {}): { refused: RecRefusal | null } {
    const ctx = this.ensureContext()
    if (ctx.recommendations && !ctx.recommendations.stale && !opts.nextBatch) {
      return { refused: null }
    }
    const input = slotsInputFrom(ctx)
    const excluded: Record<string, string[]> = {}
    if (opts.nextBatch && ctx.recommendations) {
      for (const [cat, cards] of Object.entries(ctx.recommendations.cards)) {
        excluded[cat] = Array.from(new Set([...(ctx.recommendations.excluded[cat] ?? []), ...cards.map((c) => c.productId)]))
      }
    }
    const outcome = recommendFromSlots(input, catalog, { exclude: excluded })
    getAppAnalyticsStore().track('recommendation_requested', { sessionId: ctx.sessionId, category: (ctx.slots.categories?.value as string[] | undefined)?.[0] })
    if (outcome.refused) {
      return { refused: outcome.refused }
    }
    ctx.recommendations = {
      turn: ctx.turnCount,
      snapshot: snapshotOf(ctx),
      stale: false,
      cards: outcome.cards,
      bundles: outcome.bundles,
      infeasible: outcome.infeasible,
      nearest: outcome.nearest,
      empty: outcome.empty,
      candidates: ctx.recommendations?.candidates ?? [],
      candidateInfo: ctx.recommendations?.candidateInfo ?? [],
      excluded
    }
    const totalCards = Object.values(outcome.cards).flat().length
    const anStore = getAppAnalyticsStore()
    if (opts.nextBatch || (ctx.recommendations?.stale ?? false)) anStore.track('recommendation_adjusted', { sessionId: ctx.sessionId })
    if (totalCards === 0 && outcome.empty) {
      anStore.track('recommendation_no_match', { sessionId: ctx.sessionId, category: (ctx.slots.categories?.value as string[] | undefined)?.[0] })
    } else {
      for (const c of Object.keys(outcome.cards)) anStore.track('recommendation_shown', { sessionId: ctx.sessionId, category: c })
    }
    if (totalCards === 0 && outcome.empty) {
      ctx.recentMessages.push({
        role: 'assistant',
        text: '暂未找到完全匹配的商品，我已在下方说明冲突条件并提供可选调整方案。本次结果仅包含当前硬性条件下的分析，不代表已生成候选。',
        turn: ctx.turnCount,
        at: Date.now()
      })
    } else {
      const catCount = Object.keys(outcome.cards).filter((c) => outcome.cards[c].length > 0).length
      const bundleCount = outcome.bundles.length
      ctx.recentMessages.push({
        role: 'assistant',
        text: `已为你生成推荐方案：${catCount} 个品类的候选商品${bundleCount > 0 ? `和 ${bundleCount} 套组合方案` : ''}。点击卡片可展开评分依据；如需调整，可以修改条件后重新生成。`,
        turn: ctx.turnCount,
        at: Date.now()
      })
    }
    this.store.save(ctx)
    return { refused: null }
  }

  toggleCandidate(productId: string, add: boolean, info?: { name: string; price: number; category: string }): SessionContext {
    const ctx = this.ensureContext()
    if (!ctx.recommendations) return ctx
    const list = new Set(ctx.recommendations.candidates)
    if (add) list.add(productId)
    else list.delete(productId)
    ctx.recommendations.candidates = Array.from(list)
    const infos = (ctx.recommendations.candidateInfo ?? []).filter((x) => x.id !== productId)
    if (add && info) infos.push({ id: productId, name: info.name, price: info.price, category: info.category })
    if (add) getAppAnalyticsStore().track('candidate_added', { sessionId: ctx.sessionId, productIds: [productId] })
    ctx.recommendations.candidateInfo = infos
    this.store.save(ctx)
    return ctx
  }
}

export function defaultStatement(intent: IntentKey, text: string): string {
  switch (intent) {
    case 'after_sale':
      if (/保修|保修期/.test(text)) {
        return '保修政策（模拟口径）：整机与核心部件保修年限不同，以商品页"售后说明"为准。'
      }
      return '已经记下你的问题了，可以继续补充情况，我会一并记录。'
    case 'complaint':
      if (/建议/.test(text)) return '感谢您的建议，已如实记录（模拟演示）。'
      return '已记录您的反馈，我们会按模拟流程跟进。'
    case 'comparison':
      return '当前演示版本尚未生成具体商品列表，接入推荐能力后将支持逐项对比。您可以先说明关注的参数，如噪音、能效、容量等。'
    case 'purchase_intent':
      return '好的，已经记下你的购买/预约意向。为保护隐私，这里只记录意向；如需安排，请告诉我期望的时间。'
    case 'chitchat_unknown':
      return '您好！我是青智家智能助手，可以帮您选购家电、比较商品或咨询售后问题。'
    default:
      return ''
  }
}

export function createAdvisor(store: SessionStore): Advisor {
  return new Advisor(store)
}

function buildReadyReply(ctx: SessionContext): string {
  const cats = (ctx.slots.categories?.value as string[] | undefined) ?? []
  const prefs = (ctx.slots.preferences?.value as string[] | undefined) ?? []
  const needs = (ctx.slots.localNeeds?.value as string[] | undefined) ?? []
  const dims = (ctx.slots.installationDimensions?.value as { location?: string; width?: number; depth?: number; height?: number; unit: string }[] | undefined) ?? []

  const prefText = [...prefs.map(prefLabel), ...needs.map(localNeedLabel)].join('、')
  let lead = '我会'
  if (prefText) lead += `优先为你筛选${prefText}的${cats.join('、')}`
  else lead += `按你的需求为你筛选${cats.join('、')}`
  const sentences: string[] = [lead + '。']

  const summary: string[] = []
  const byCat = ctx.slots.itemBudgetByCategory?.value as Record<string, number> | undefined
  if (byCat && Object.keys(byCat).length > 0) {
    summary.push(Object.entries(byCat).map(([k, v]) => `${k}预算${v}元`).join('、'))
  } else if (ctx.slots.totalBudget) {
    const tbv = ctx.slots.totalBudget.value as unknown
    summary.push(typeof tbv === 'object' && tbv ? `总预算${(tbv as { min?: number }).min ?? ''}～${(tbv as { max?: number }).max ?? ''}元` : `总预算${String(tbv)}元`)
  } else {
    const range = ctx.slots.itemBudgetRange?.value as { min: number; max: number } | undefined
    if (range) summary.push(`预算${range.min}～${range.max}元`)
    else if (ctx.slots.itemBudget) summary.push(`预算${ctx.slots.itemBudget.value}元`)
  }
  const familySize = ctx.slots.familySize?.value as number | undefined
  const familyMin = ctx.slots.familySizeMin?.value as number | undefined
  if (familySize) summary.push(familyPhrase(familySize))
  else if (familyMin) summary.push(`${familyMin} 人及以上家庭`)
  const roomArea = ctx.slots.roomArea?.value as number | undefined
  if (roomArea) summary.push(`房间面积${roomArea}㎡`)
  const houseArea = ctx.slots.houseArea?.value as number | undefined
  if (houseArea) summary.push(`住房面积${houseArea}㎡`)
  if (ctx.slots.location) summary.push(`所在城市${String(ctx.slots.location.value)}`)
  if (dims.length > 0) {
    summary.push(
      dims
        .map((d) => `${d.location ?? '安装位'}预留${[d.width && `宽${d.width}`, d.depth && `深${d.depth}`, d.height && `高${d.height}`].filter(Boolean).join('')}${d.unit}`)
        .join('、')
    )
  }
  if (prefText) summary.push(`偏好${prefText}`)
  if (summary.length > 0) sentences.push(`当前需求为：${summary.join('、')}。`)

  sentences.push('信息已经足够，可以生成推荐方案。')
  sentences.push(dims.length > 0 ? '如果还有其他要求，也可以继续告诉我。' : '如果还有安装尺寸、节能或静音方面的要求，也可以继续告诉我。')
  return sentences.join('')
}
