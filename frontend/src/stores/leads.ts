// 统一业务记录 Store：购买线索 / 售后记录 / 投诉记录 + 审计日志 + 演示角色（仅localStorage）
import { computed, reactive } from 'vue'
import type { SessionContext } from '../engine/types.ts'
import { maskPhone, scorePurchaseLead } from '../engine/leadScore.ts'
import { getAppAnalyticsStore } from './analytics.ts'

export type BusinessRecordType = 'purchase_lead' | 'after_sales_case' | 'complaint_case'
export type ActorRole = 'consumer' | 'operator'

export interface ContactInfo { name?: string; phone?: string; preferredTime?: string; withdrawn?: boolean }
export interface BusinessRecord {
  id: string
  type: BusinessRecordType
  sessionId: string
  createdAt: string
  updatedAt: string
  status: string
  intentScore?: number
  intentLevel?: '高' | '中' | '低'
  scoreItems?: { key: string; label: string; score: number; basis: string }[]
  needsSummary: string
  slotsSnapshot: object
  productIds: string[]
  comparisonIds: string[]
  conversationSummary: string
  requestedAction: string
  contact?: ContactInfo
  consent: { given: boolean; givenAt?: string; purposeTextSnapshot?: string; policyVersion?: string; withdrawnAt?: string }
  source: string
  simulated: true
  notes: { at: string; role: ActorRole; text: string }[]
  faqId?: string
  triedSuggestion?: boolean
  priority?: '高' | '中' | '低'
}

export interface AuditEntry {
  auditId: string
  actorRole: ActorRole
  action: string
  targetId: string | null
  timestamp: string
  result: 'success' | 'denied'
  nonSensitiveSummary: string
}

const RECORD_CAP = 50
const STATUS_FLOW: Record<BusinessRecordType, string[]> = {
  purchase_lead: ['新建', '待确认', '跟进中', '已转化（模拟）', '已关闭'],
  after_sales_case: ['待处理', '排查中', '待服务', '已解决', '已关闭'],
  complaint_case: ['待处理', '调查中', '协商中', '已解决', '已关闭']
}
const LEVEL_PRIORITY: Record<string, '高' | '中' | '低'> = { 高: '高', 中: '中', 低: '低' }

export class LeadsStore {
  records = reactive<BusinessRecord[]>([])
  audit = reactive<AuditEntry[]>([])
  role = reactive<{ current: ActorRole }>({ current: 'consumer' })
  private storage: StorageLike
  private key: string
  private auditKey: string

  constructor(storage: StorageLike, key = 'qzad.leads.v1', auditKey = 'qzad.audit.v1') {
    this.storage = storage
    this.key = key
    this.auditKey = auditKey
    this.restore()
  }

  has(id: string): boolean { return this.records.some((r) => r.id === id) }
  setRole(role: ActorRole): void {
    this.role.current = role
    try { globalThis.localStorage.setItem('qzad.role.v1', role) } catch { /* 忽略 */ }
    this.auditEvent(role, role === 'operator' ? 'role_switch_operator' : 'role_switch_consumer', null, 'success', '切换演示视角（非真实登录）')
  }
  bySession(sessionId: string): BusinessRecord[] { return this.records.filter((r) => r.sessionId === sessionId) }
  readonly total = computed(() => this.records.length)
  readonly byType = (t: BusinessRecordType) => this.records.filter((r) => r.type === t)
  readonly highIntentCount = computed(() => this.records.filter((r) => r.intentLevel === '高').length)

  private newId(prefix: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let s = ''
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return `${prefix}-${s}`
  }

  private nowIso(): string { return new Date().toISOString() }

  auditEvent(actorRole: ActorRole, action: string, targetId: string | null, result: 'success' | 'denied', summary: string): void {
    this.audit.push({ auditId: this.newId('AUD'), actorRole, action, targetId, timestamp: this.nowIso(), result, nonSensitiveSummary: summary })
    this.persistAudit()
  }

  scoreOf(ctx: SessionContext, flags: { explicitBuy?: boolean; commerceAsk?: boolean; consentGiven?: boolean }) {
    return scorePurchaseLead(ctx, flags)
  }

  createPurchaseLead(opts: {
    ctx: SessionContext
    sessionId: string
    contact: { name?: string; phone: string; preferredTime?: string }
    consentGiven: boolean
    policyVersion?: string
    source?: string
    productIds?: string[]
    comparisonIds?: string[]
  }): BusinessRecord {
    const score = scorePurchaseLead(opts.ctx, { consentGiven: opts.consentGiven, explicitBuy: true })
    const now = this.nowIso()
    const rec: BusinessRecord = {
      id: this.newId('LEAD'),
      type: 'purchase_lead',
      sessionId: opts.sessionId,
      createdAt: now,
      updatedAt: now,
      status: '新建',
      intentScore: score.total,
      intentLevel: score.level,
      scoreItems: score.items,
      needsSummary: needsSummaryOf(opts.ctx),
      slotsSnapshot: JSON.parse(JSON.stringify(slotsSnapshotOf(opts.ctx))),
      productIds: opts.productIds ?? [],
      comparisonIds: opts.comparisonIds ?? [],
      conversationSummary: '用户完成需求咨询并同意生成演示线索（模拟）',
      requestedAction: '跟进确认购买意向（模拟流程）',
      contact: { name: opts.contact.name, phone: opts.contact.phone, preferredTime: opts.contact.preferredTime },
      consent: { given: opts.consentGiven, givenAt: now, purposeTextSnapshot: CONSENT_PURPOSE_TEXT, policyVersion: opts.policyVersion ?? 'v1' },
      source: opts.source ?? '聊天指令',
      simulated: true,
      notes: []
    }
    this.insert(rec)
    getAppAnalyticsStore().track('lead_created', { sessionId: opts.sessionId, recordId: rec.id, payload: { level: rec.intentLevel ?? '低', intentScore: rec.intentScore ?? 0 } })
    this.auditEvent(this.role.current, 'lead_created', rec.id, 'success', `创建购买线索（意向 ${score.total} 分/${score.level}，联系方式脱敏保存）`)
    this.auditEvent(this.role.current, 'lead_score_updated', rec.id, 'success', `意向评分 ${score.total} 分（${score.level}）`)
    return rec
  }

  createAfterSalesCase(opts: { sessionId: string; category: string; ownedDuration?: string; faults: string[]; faqId?: string; tried: boolean; resolved: boolean; expectation: string }): BusinessRecord {
    const now = this.nowIso()
    const priority: '高' | '中' | '低' = opts.resolved ? '低' : opts.faults.some((f) => ['漏电', '跳闸', '冒烟', '烧焦味'].includes(f)) ? '高' : '中'
    const rec: BusinessRecord = {
      id: this.newId('SVC'),
      type: 'after_sales_case',
      sessionId: opts.sessionId,
      createdAt: now,
      updatedAt: now,
      status: '待处理',
      needsSummary: `售后跟进：${opts.category} ${opts.faults.join('、') || '（待补充故障）'}`,
      slotsSnapshot: {},
      productIds: [],
      comparisonIds: [],
      conversationSummary: `故障：${opts.faults.join('、') || '—'}；已尝试建议：${opts.tried ? '是' : '否'}；是否解决：${opts.resolved ? '已解决' : '未解决'}`,
      requestedAction: opts.expectation || '上门检测（模拟流程）',
      consent: { given: true, givenAt: now, purposeTextSnapshot: CONSENT_PURPOSE_TEXT, policyVersion: 'v1' },
      source: '聊天指令',
      simulated: true,
      notes: [],
      faqId: opts.faqId,
      triedSuggestion: opts.tried,
      priority
    }
    this.insert(rec)
    getAppAnalyticsStore().track('after_sales_case_created', { sessionId: opts.sessionId, recordId: rec.id, category: opts.category, payload: { priority: rec.priority ?? '中' } })
    this.auditEvent(this.role.current, 'after_sales_case_created', rec.id, 'success', `创建售后记录（${opts.category}，优先级 ${priority}）`)
    return rec
  }

  createComplaintCase(opts: { sessionId: string; topic: string; detail: string; expectation: string; ticketRef?: string; contactConsent: boolean }): BusinessRecord {
    const now = this.nowIso()
    const rec: BusinessRecord = {
      id: opts.ticketRef ?? this.newId('CPL'),
      type: 'complaint_case',
      sessionId: opts.sessionId,
      createdAt: now,
      updatedAt: now,
      status: '待处理',
      needsSummary: `投诉：${opts.topic}`,
      slotsSnapshot: {},
      productIds: [],
      comparisonIds: [],
      conversationSummary: `事件说明：${opts.detail}；期望处理：${opts.expectation}`,
      requestedAction: opts.expectation,
      consent: { given: opts.contactConsent, givenAt: opts.contactConsent ? now : undefined, purposeTextSnapshot: CONSENT_PURPOSE_TEXT, policyVersion: 'v1' },
      source: '聊天指令',
      simulated: true,
      notes: [],
      priority: '高'
    }
    this.insert(rec)
    getAppAnalyticsStore().track('complaint_case_created', { sessionId: opts.sessionId, recordId: rec.id })
    this.auditEvent(this.role.current, 'complaint_case_created', rec.id, 'success', `创建投诉记录（${opts.topic}，服务优先级 ${rec.priority}）`)
    return rec
  }

  migrateComplaint(sessionId: string, ticket: { ticketId: string; topic: string; preference: string }): BusinessRecord | null {
    if (this.has(ticket.ticketId)) return null
    return this.createComplaintCase({ sessionId, topic: ticket.topic, detail: '由原模拟投诉记录迁移（兼容旧会话）', expectation: ticket.preference, ticketRef: ticket.ticketId, contactConsent: true })
  }

  setStatus(id: string, next: string, actorRole: ActorRole): { ok: boolean; reason?: string } {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return { ok: false, reason: '记录不存在' }
    const flow = STATUS_FLOW[rec.type]
    if (!flow.includes(next)) return { ok: false, reason: `${next} 不是${typeName(rec.type)}的合法状态` }
    const from = rec.status
    if (from === next) return { ok: false, reason: '状态未变化' }
    if (flow.indexOf(next) < flow.indexOf(from)) return { ok: false, reason: `不能从「${from}」回退到「${next}」，只允许沿流程前进` }
    rec.status = next
    rec.updatedAt = this.nowIso()
    getAppAnalyticsStore().track('lead_status_changed', { sessionId: rec.sessionId, recordId: id, payload: { next } })
    this.auditEvent(actorRole, 'lead_status_changed', id, 'success', `${typeName(rec.type)} 状态：${from} → ${next}（模拟状态，非真实交易结果）`)
    this.persist()
    return { ok: true }
  }

  addNote(id: string, role: ActorRole, text: string): void {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return
    rec.notes.push({ at: this.nowIso(), role, text: text.replace(/1[3-9]\d{9}/g, (m) => maskPhone(m)) })
    rec.updatedAt = this.nowIso()
    this.persist()
  }

  viewSensitiveContact(id: string, actorRole: ActorRole): string | null {
    const rec = this.records.find((r) => r.id === id)
    if (!rec?.contact?.phone) return null
    if (rec.contact.withdrawn) return null
    this.auditEvent(actorRole, 'sensitive_contact_viewed', id, 'success', '运营人员二次确认后查看完整联系方式（仅模拟演示）')
    return rec.contact.phone
  }

  withdrawConsent(id: string, actorRole: ActorRole): boolean {
    const rec = this.records.find((r) => r.id === id)
    if (!rec?.consent.given) return false
    if (rec.contact?.phone) {
      rec.contact = { name: rec.contact.name, preferredTime: rec.contact.preferredTime, withdrawn: true }
    }
    rec.consent.given = false
    rec.consent.withdrawnAt = this.nowIso()
    rec.updatedAt = rec.consent.withdrawnAt
    this.auditEvent(actorRole, 'consent_withdrawn', id, 'success', '用户撤回授权：完整联系方式已删除，仅保留非敏感业务摘要')
    getAppAnalyticsStore().track('consent_withdrawn', { sessionId: rec.sessionId, recordId: id })
    this.persist()
    return true
  }

  remove(id: string, actorRole: ActorRole): boolean {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return false
    this.records.splice(this.records.indexOf(rec), 1)
    this.auditEvent(actorRole, 'lead_deleted', id, 'success', `删除${typeName(rec.type)}（含其联系方式，公共模拟数据不受影响）`)
    getAppAnalyticsStore().track('record_deleted', { sessionId: rec.sessionId, recordId: id })
    this.persist()
    return true
  }

  exportFor(sessionId: string | null): string {
    const list = sessionId ? this.bySession(sessionId) : this.records
    const masked = list.map((r) => ({ ...r, contact: r.contact?.phone ? { ...r.contact, phone: maskPhone(r.contact.phone) } : r.contact }))
    this.auditEvent(this.role.current, 'lead_exported', null, 'success', `导出 ${masked.length} 条记录（联系方式脱敏，JSON格式）`)
    return JSON.stringify({
      disclaimer: '模拟数据声明：以下记录为竞赛演示数据，仅保存在当前浏览器localStorage，不会提交给真实企业；联系方式已脱敏。',
      exportedAt: this.nowIso(),
      policyVersion: 'v1',
      records: masked
    }, null, 2)
  }

  insert(rec: BusinessRecord): void {
    this.records.push(rec)
    while (this.records.length > RECORD_CAP) this.records.shift()
    this.persist()
  }

  persist(): void {
    try {
      this.storage.setItem(this.key, JSON.stringify({ records: this.records, meta: { policyVersion: 'v1' } }))
    } catch { /* 忽略 */ }
  }

  persistAudit(): void {
    try {
      this.storage.setItem(this.auditKey, JSON.stringify(this.audit.slice(-200)))
    } catch { /* 忽略 */ }
  }

  restore(): void {
    try {
      const raw = this.storage.getItem(this.key)
      if (raw) {
        const parsed = JSON.parse(raw)
        const list = Array.isArray(parsed.records) ? parsed.records : []
        this.records.splice(0, this.records.length, ...list.slice(-RECORD_CAP))
      }
      const ar = this.storage.getItem(this.auditKey)
      if (ar) {
        const parsed = JSON.parse(ar)
        this.audit.splice(0, this.audit.length, ...(Array.isArray(parsed) ? parsed : []))
      }
    } catch {
      this.records.splice(0, this.records.length)
      this.audit.splice(0, this.audit.length)
    }
  }
}

export const CONSENT_PURPOSE_TEXT = '用途：生成竞赛演示用线索/服务记录；数据：称呼（可选）、模拟手机号、期望联系时间（可选）；保存位置：当前浏览器localStorage；不会提交给真实企业或真实工作人员；你可随时查看、导出或删除。'
function typeName(t: BusinessRecordType): string {
  return t === 'purchase_lead' ? '购买线索' : t === 'after_sales_case' ? '售后记录' : '投诉记录'
}
function slotsSnapshotOf(ctx: SessionContext): object {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx.slots)) out[k] = v?.value
  return out
}
function needsSummaryOf(ctx: SessionContext): string {
  const s = ctx.slots
  const cats = (s.categories?.value as string[] | undefined) ?? []
  return [cats.length ? `品类：${cats.join('、')}` : '', s.totalBudget ? `总预算 ${s.totalBudget.value} 元` : '', s.familySize ? `家庭 ${s.familySize.value} 口` : '', (s.preferences?.value as string[] | undefined)?.length ? `偏好：${(s.preferences?.value as string[]).join('、')}` : ''].filter(Boolean).join('｜') || '（待补充）'
}

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class MemoryLeadsStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
}

let singleton: LeadsStore | null = null
export function getAppLeadsStore(): LeadsStore {
  if (singleton) return singleton
  let storage: StorageLike
  try {
    globalThis.localStorage.setItem('__probe__', '1')
    globalThis.localStorage.removeItem('__probe__')
    storage = globalThis.localStorage
  } catch { storage = new MemoryLeadsStorage() }
  singleton = new LeadsStore(storage)
  return singleton
}

export function getAppRole(): ActorRole {
  if (singleton) return singleton.role.current
  try {
    const r = globalThis.localStorage.getItem('qzad.role.v1')
    return r === 'operator' ? 'operator' : 'consumer'
  } catch { return 'consumer' }
}
export function setAppRole(role: ActorRole): void {
  try { globalThis.localStorage.setItem('qzad.role.v1', role) } catch { /* 忽略 */ }
  if (singleton) singleton.role.current = role
}
export { LEVEL_PRIORITY }
