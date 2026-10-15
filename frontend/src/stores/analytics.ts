// 统一分析事件层：实际演示事件 + 可复现示例数据；不含姓名/完整手机号/聊天原文
import { reactive } from 'vue'

export type DataOrigin = 'actual' | 'sample'
export interface AnalyticsEvent {
  eventId: string
  sessionId: string
  type: string
  category?: string
  productIds?: string[]
  recordId?: string
  intent?: string
  processingTimeMs?: number
  source: string
  dataOrigin: DataOrigin
  at: string
  payload?: Record<string, string | number | boolean | null>
}

const CAP = 800
export class MemoryAnalyticsStorage { private m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null } setItem(k: string, v: string) { this.m.set(k, v) } removeItem(k: string) { this.m.delete(k) } }
export interface AnalyticsStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function rid(prefix: string): string {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]
  return `${prefix}-${s}`
}

export class AnalyticsStore {
  events = reactive<AnalyticsEvent[]>([])
  private storage: AnalyticsStorage
  private key: string

  constructor(storage: AnalyticsStorage, key = 'qzad.analytics.v1') {
    this.storage = storage
    this.key = key
    this.restore()
  }

  track(type: string, opts: Partial<Omit<AnalyticsEvent, 'eventId' | 'type'>> & { opKey?: string; at?: string } = {}): void {
    const { opKey, ...rest } = opts
    if (rest.payload) {
      for (const [k, v] of Object.entries(rest.payload)) {
        if (typeof v === 'string') rest.payload[k] = v.replace(/1[3-9]\d{9}/g, (m) => `${m.slice(0, 3)}****${m.slice(7)}`)
      }
    }
    if (opKey) {
      const dup = this.events.some((e) => e.type === type && e.sessionId === (rest.sessionId ?? '') && e.payload?.opKey === opKey)
      if (dup) return
      rest.payload = { ...(rest.payload ?? {}), opKey }
    }
    const ev: AnalyticsEvent = {
      eventId: rid('EV'),
      sessionId: rest.sessionId ?? 'S-unknown',
      type,
      category: rest.category,
      productIds: rest.productIds,
      recordId: rest.recordId,
      intent: rest.intent,
      processingTimeMs: rest.processingTimeMs,
      source: rest.source ?? '应用操作',
      dataOrigin: rest.dataOrigin ?? 'actual',
      at: rest.at ?? new Date().toISOString(),
      payload: rest.payload
    }
    this.events.push(ev)
    if (this.events.length > CAP) this.events.splice(0, this.events.length - CAP)
    this.persist()
  }

  persist(): void {
    try { this.storage.setItem(this.key, JSON.stringify(this.events.slice(-CAP))) } catch { /* 忽略 */ }
  }
  restore(): void {
    try {
      const raw = this.storage.getItem(this.key)
      const list = raw ? JSON.parse(raw) : []
      this.events.splice(0, this.events.length, ...(Array.isArray(list) ? list : []))
    } catch { this.events.splice(0, this.events.length) }
  }
  clearActual(): void {
    this.events.splice(0, this.events.length, ...this.events.filter((e) => e.dataOrigin !== 'actual'))
    this.persist()
  }
  clearSample(): void {
    this.events.splice(0, this.events.length, ...this.events.filter((e) => e.dataOrigin !== 'sample'))
    this.persist()
  }
}

let singleton: AnalyticsStore | null = null
export function getAppAnalyticsStore(): AnalyticsStore {
  if (singleton) return singleton
  let storage: AnalyticsStorage
  try { globalThis.localStorage.setItem('__ap__', '1'); globalThis.localStorage.removeItem('__ap__'); storage = globalThis.localStorage } catch { storage = new MemoryAnalyticsStorage() }
  singleton = new AnalyticsStore(storage)
  return singleton
}

// ===== 指标计算（纯函数：输入事件集，输出 null 表示分母为0/暂无数据） =====
export interface Filters { days: 'today' | '7d' | 'all' | 'custom'; from?: string; to?: string; origin: 'all' | 'actual' | 'sample' }
function inRange(ev: AnalyticsEvent, f: Filters): boolean {
  if (f.origin !== 'all' && ev.dataOrigin !== f.origin) return false
  if (f.days === 'all') return true
  const t = new Date(ev.at)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (f.days === 'today') return t >= startOfToday
  if (f.days === '7d') return t >= new Date(startOfToday.getTime() - 6 * 864e5)
  const from = f.from ? new Date(f.from) : null
  const to = f.to ? new Date(f.to + 'T23:59:59') : null
  if (from && t < from) return false
  if (to && t > to) return false
  return true
}
export function filteredEvents(events: AnalyticsEvent[], f: Filters): AnalyticsEvent[] {
  return events.filter((e) => inRange(e, f))
}
const sessionsOf = (evs: AnalyticsEvent[], type?: string) => new Set(evs.filter((e) => !type || e.type === type).map((e) => e.sessionId))
export function rate(num: number, den: number): number | null {
  if (!den) return null
  return Math.round((num / den) * 1000) / 10
}
export interface Metrics {
  effectiveSessions: number
  intentDist: Record<string, number>
  recTriggerRate: number | null
  recNoMatchRate: number | null
  compareUsageRate: number | null
  consentRate: number | null
  consultToRecRate: number | null
  recToCompareRate: number | null
  compareToLeadRate: number | null
  faqResolveRate: number | null
  avgResponseMs: number | null
  p95ResponseMs: number | null
  funnel: { key: string; label: string; sessions: number; stepRate: number | null }[]
  topCategories: { category: string; count: number }[]
  trend7d: { day: string; sessions: number; rec: number; compare: number; leads: number }[]
  quality: { missingSession: number; duplicates: number; unclassified: number; aux: number }
  incompleteChain: number
  auxEvents: number
  highIntent: number
  afterSales: { total: number; unresolved: number; highPriority: number }
  complaints: { total: number }
}
const VALID_INTENTS = new Set(['pre_sale', 'comparison', 'after_sale', 'complaint', 'purchase_intent'])
// 合法事件类型全集：业务指标事件 + 辅助事件；只有未知类型/结构损坏才计入“异常事件”
export const BUSINESS_TYPES = new Set(['intent_detected', 'faq_matched', 'faq_resolved', 'faq_unresolved', 'recommendation_requested', 'recommendation_shown', 'recommendation_no_match', 'recommendation_adjusted', 'compare_started', 'lead_consent_requested', 'lead_consent_granted', 'lead_consent_declined', 'lead_created', 'lead_status_changed', 'purchase_intent_detected', 'after_sales_case_created', 'complaint_case_created', 'consent_withdrawn', 'record_deleted', 'safety_guard_triggered', 'candidate_added'])
export const AUX_TYPES = new Set(['user_message_sent', 'session_started', 'compare_item_added', 'compare_viewed', 'compare_difference_only', 'intent_clarified'])
export function computeMetrics(evs: AnalyticsEvent[]): Metrics {
  const quality = {
    missingSession: evs.filter((e) => !e.sessionId || e.sessionId === 'S-unknown').length,
    duplicates: evs.length - new Set(evs.map((e) => e.eventId)).size,
    unclassified: evs.filter((e) => !BUSINESS_TYPES.has(e.type) && !AUX_TYPES.has(e.type)).length,
    aux: evs.filter((e) => AUX_TYPES.has(e.type)).length
  }
  const consulted = new Set<string>()
  const intentBySession: Record<string, Set<string>> = {}
  for (const e of evs) {
    if (e.type === 'intent_detected' && e.intent && VALID_INTENTS.has(e.intent) && e.intent !== 'after_sale' && e.intent !== 'complaint') consulted.add(e.sessionId)
    if (e.type === 'intent_detected' && e.intent) {
      ;(intentBySession[e.sessionId] ??= new Set()).add(e.intent)
    }
  }
  const effectiveSessions = consulted.size
  const intentDist: Record<string, number> = {}
  for (const s of Object.keys(intentBySession)) for (const i of intentBySession[s]) intentDist[i] = (intentDist[i] ?? 0) + 1
  const recShown = sessionsOf(evs, 'recommendation_shown')
  const recReq = sessionsOf(evs, 'recommendation_requested')
  const recNo = sessionsOf(evs, 'recommendation_no_match')
  const cmpStarted = sessionsOf(evs, 'compare_started')
  const consentReq = sessionsOf(evs, 'lead_consent_requested')
  const consentOk = sessionsOf(evs, 'lead_consent_granted')
  const leadCreated = new Set(evs.filter((e) => e.type === 'lead_created').map((e) => e.sessionId))
  const converted = new Set(evs.filter((e) => e.type === 'lead_status_changed' && e.payload?.next === '已转化（模拟）').map((e) => e.sessionId))
  const faqAnswered = new Set(evs.filter((e) => e.type === 'faq_matched').map((e) => e.sessionId))
  const faqResolved = new Set(evs.filter((e) => e.type === 'faq_resolved').map((e) => e.sessionId))
  const times = evs.map((e) => e.processingTimeMs).filter((t): t is number => typeof t === 'number' && t >= 0).sort((a, b) => a - b)
  const p95 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : null
  const funnelDefs: [string, string, Set<string>][] = [
    ['consult', '有效咨询', consulted],
    ['rec', '生成推荐', recShown],
    ['compare', '商品对比', cmpStarted],
    ['consent', '同意联系', consentOk],
    ['lead', '生成购买线索', leadCreated],
    ['converted', '已转化（模拟）', converted]
  ]
  let prev: number | null = null
  let incompleteChain = 0
  const funnel = funnelDefs.map(([key, label, set]) => {
    const raw = set.size
    const n = prev !== null ? Math.min(raw, prev) : raw
    if (raw > n) incompleteChain += 1
    const stepRate = prev !== null && prev > 0 ? rate(n, prev) : null
    prev = n
    return { key, label, sessions: n, stepRate }
  })
  const catCount: Record<string, number> = {}
  for (const e of evs) if (e.type === 'recommendation_shown' && e.category) catCount[e.category] = (catCount[e.category] ?? 0) + 1
  const topCategories = Object.entries(catCount).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 6)
  const days: string[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push(`${d.getMonth() + 1}-${d.getDate()}`) }
  const trend7d = days.map((day) => {
    const md = day.split('-').map(Number)
    const same = (e: AnalyticsEvent) => { const d = new Date(e.at); return d.getMonth() + 1 === md[0] && d.getDate() === md[1] }
    return {
      day,
      sessions: new Set(evs.filter((e) => e.type === 'user_message_sent' && same(e)).map((e) => e.sessionId)).size,
      rec: new Set(evs.filter((e) => e.type === 'recommendation_shown' && same(e)).map((e) => e.sessionId)).size,
      compare: new Set(evs.filter((e) => e.type === 'compare_started' && same(e)).map((e) => e.sessionId)).size,
      leads: new Set(evs.filter((e) => e.type === 'lead_created' && same(e)).map((e) => e.sessionId)).size
    }
  })
  const afterSalesRecords = evs.filter((e) => e.type === 'after_sales_case_created')
  return {
    effectiveSessions,
    intentDist,
    recTriggerRate: rate(recShown.size, [...consulted].filter((s) => { const intents = intentBySession[s]; return intents && [...intents].some((i) => i === 'pre_sale' || i === 'comparison' || i === 'purchase_intent') }).length),
    recNoMatchRate: rate(recNo.size, recReq.size),
    compareUsageRate: rate(cmpStarted.size, recShown.size),
    consentRate: rate(consentOk.size, consentReq.size),
    consultToRecRate: rate(recShown.size, effectiveSessions),
    recToCompareRate: rate(cmpStarted.size, recShown.size),
    compareToLeadRate: rate(leadCreated.size, cmpStarted.size),
    faqResolveRate: rate(faqResolved.size, faqAnswered.size),
    avgResponseMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    p95ResponseMs: p95,
    funnel,
    topCategories,
    trend7d,
    auxEvents: evs.filter((e) => AUX_TYPES.has(e.type)).length,
    highIntent: (() => {
      const seen = new Set<string>()
      let n = 0
      for (const e of evs) {
        if (e.type !== 'lead_created') continue
        const rid2 = e.recordId ?? e.eventId
        if (seen.has(rid2)) continue
        seen.add(rid2)
        const score = typeof e.payload?.intentScore === 'number' ? e.payload.intentScore : null
        const rawLevel = typeof e.payload?.level === 'string' ? e.payload.level : ''
        const norm = ({ '高': 'high', '中': 'mid', '低': 'low' } as Record<string, string>)[rawLevel] ?? rawLevel
        if ((score !== null && score >= 70) || norm === 'high') n += 1
      }
      return n
    })(),
    quality,
    incompleteChain,
    afterSales: { total: afterSalesRecords.length, unresolved: evs.filter((e) => e.type === 'faq_unresolved').length, highPriority: evs.filter((e) => e.type === 'after_sales_case_created' && e.payload?.priority === '高').length },
    complaints: { total: evs.filter((e) => e.type === 'complaint_case_created').length }
  }
}

// ===== 示例数据：固定种子，7天，200+事件，完整链路 =====
export function generateSampleEvents(): AnalyticsEvent[] {
  let seed = 20260401
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const cats = ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机']
  const out: AnalyticsEvent[] = []
  const now = new Date()
  let n = 0
  let leadSeq = 0
  for (let d = 6; d >= 0; d--) {
    const daySessions = 6 + Math.floor(rnd() * 4)
    for (let s = 0; s < daySessions; s++) {
      const sid = `S-sample-${d}-${s}`
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d, 9 + Math.floor(rnd() * 10), Math.floor(rnd() * 60))
      const at = (offsetMin: number) => new Date(base.getTime() + offsetMin * 60000).toISOString()
      const cat = pick(cats)
      const intent = pick(['pre_sale', 'pre_sale', 'pre_sale', 'comparison', 'after_sale', 'complaint', 'purchase_intent'])
      out.push({ eventId: rid('EV'), sessionId: sid, type: 'user_message_sent', source: '示例数据生成器', dataOrigin: 'sample', at: at(0), payload: { opKey: `m${n++}` } })
      out.push({ eventId: rid('EV'), sessionId: sid, type: 'intent_detected', intent, source: '示例数据生成器', dataOrigin: 'sample', at: at(0), processingTimeMs: Math.round(8 + rnd() * 40) })
      const isPre = intent === 'pre_sale' || intent === 'purchase_intent'
      if (isPre) {
        out.push({ eventId: rid('EV'), sessionId: sid, type: 'recommendation_requested', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(2) })
        if (rnd() > 0.12) {
          out.push({ eventId: rid('EV'), sessionId: sid, type: 'recommendation_shown', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(3) })
          if (rnd() > 0.45) {
            out.push({ eventId: rid('EV'), sessionId: sid, type: 'compare_started', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(5) })
            out.push({ eventId: rid('EV'), sessionId: sid, type: 'compare_viewed', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(6) })
            if (rnd() > 0.4) {
              out.push({ eventId: rid('EV'), sessionId: sid, type: 'lead_consent_requested', source: '示例数据生成器', dataOrigin: 'sample', at: at(8) })
              if (rnd() > 0.35) {
                out.push({ eventId: rid('EV'), sessionId: sid, type: 'lead_consent_granted', source: '示例数据生成器', dataOrigin: 'sample', at: at(9) })
                leadSeq += 1
                const level = leadSeq === 2 || leadSeq === 5 ? '高' : leadSeq % 2 === 0 ? '中' : '低'
                const score = level === '高' ? 75 + Math.floor(rnd() * 20) : level === '中' ? 45 + Math.floor(rnd() * 20) : 20 + Math.floor(rnd() * 19)
                out.push({ eventId: rid('EV'), sessionId: sid, type: 'lead_created', source: '示例数据生成器', dataOrigin: 'sample', at: at(10), payload: { level, intentScore: score } })
                if (rnd() > 0.7) out.push({ eventId: rid('EV'), sessionId: sid, type: 'lead_status_changed', source: '示例数据生成器', dataOrigin: 'sample', at: at(11), payload: { next: '已转化（模拟）' } })
              } else out.push({ eventId: rid('EV'), sessionId: sid, type: 'lead_consent_declined', source: '示例数据生成器', dataOrigin: 'sample', at: at(9) })
            }
          }
        } else out.push({ eventId: rid('EV'), sessionId: sid, type: 'recommendation_no_match', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(3) })
      } else if (intent === 'after_sale') {
        out.push({ eventId: rid('EV'), sessionId: sid, type: 'faq_matched', source: '示例数据生成器', dataOrigin: 'sample', at: at(2) })
        if (rnd() > 0.5) out.push({ eventId: rid('EV'), sessionId: sid, type: 'faq_resolved', source: '示例数据生成器', dataOrigin: 'sample', at: at(4) })
        else {
          out.push({ eventId: rid('EV'), sessionId: sid, type: 'faq_unresolved', source: '示例数据生成器', dataOrigin: 'sample', at: at(4) })
          out.push({ eventId: rid('EV'), sessionId: sid, type: 'after_sales_case_created', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(5), payload: { priority: rnd() > 0.7 ? '高' : '中' } })
        }
      } else if (intent === 'complaint') out.push({ eventId: rid('EV'), sessionId: sid, type: 'complaint_case_created', category: cat, source: '示例数据生成器', dataOrigin: 'sample', at: at(2) })
    }
  }
  return out
}
