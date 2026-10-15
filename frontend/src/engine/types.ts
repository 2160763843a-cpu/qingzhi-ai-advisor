import type { Category } from '../types/data.ts'

export type IntentKey =
  | 'pre_sale'
  | 'comparison'
  | 'after_sale'
  | 'complaint'
  | 'purchase_intent'
  | 'chitchat_unknown'

export type BusinessIntent = Exclude<IntentKey, 'chitchat_unknown'>

export const ALL_INTENTS: IntentKey[] = [
  'pre_sale',
  'comparison',
  'after_sale',
  'complaint',
  'purchase_intent',
  'chitchat_unknown'
]

export const INTENT_PRIORITY: Record<IntentKey, number> = {
  complaint: 6,
  after_sale: 5,
  purchase_intent: 4,
  comparison: 3,
  pre_sale: 2,
  chitchat_unknown: 1
}

export const CONFIDENCE_THRESHOLD = 0.6

export interface MatchedSignal {
  word: string
  intent: IntentKey
  weight: number
  type: 'pattern' | 'context' | 'continuation' | 'statistical'
}

export interface IntentResult {
  primaryIntent: IntentKey
  confidence: number
  matchedSignals: MatchedSignal[]
  alternativeIntent: IntentKey | null
  needsClarification: boolean
  clarificationQuestion: string
  processingTimeMs: number
}

export interface DimEntry {
  location?: string
  width?: number
  depth?: number
  height?: number
  unit: string
  turn: number
}

export interface SlotValue<T> {
  value: T
  turn: number
  raw: string
}

export type SlotKey =
  | 'categories'
  | 'totalBudget'
  | 'itemBudget'
  | 'itemBudgetRange'
  | 'itemBudgetByCategory'
  | 'familySize'
  | 'familySizeMin'
  | 'houseArea'
  | 'roomArea'
  | 'installationDimensions'
  | 'location'
  | 'preferences'
  | 'localNeeds'
  | 'purchaseTime'
  | 'ownedDuration'
  | 'faultSymptoms'
  | 'contactIntent'
  | 'complaintTopic'
  | 'complaintResolution'
  | 'faultDuration'
  | 'safetyConfirmed'
  | 'contactWillingness'
  | 'totalBudgetMin'
  | 'leadConsent'
  | 'depthUnknown'
  | 'dimensionsSkipped'
  | 'kbResolution'
  | 'orderRef'
  | 'suggestion'
  | 'budgetNote'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  turn: number
  at: number
}

export interface ChangeLogEntry {
  turn: number
  action: 'set' | 'update' | 'add-item' | 'remove-item' | 'delete-slot'
  key: SlotKey
  detail: string
}

export interface ComplaintRecord {
  ticketId: string
  topic: string
  preference: string
  consent: boolean
  createdAt: number
  status: '待处理（演示）'
}

export type DialogueState =
  | 'idle'
  | 'safety'
  | 'awaiting_complaint_detail'
  | 'awaiting_resolution_preference'
  | 'awaiting_followup_consent'
  | 'followup_declined'
  | 'followup_accepted'
  | 'awaiting_kb_resolution'
  | 'awaiting_comparison_targets'
  | 'awaiting_budget'
  | 'awaiting_category'
  | 'ready_for_recommendation'

export interface SessionContext {
  sessionId: string
  turnCount: number
  currentIntent: IntentKey | null
  intentHistory: { intent: IntentKey; turn: number; confidence: number }[]
  slots: Partial<Record<SlotKey, SlotValue<unknown>>>
  changeLog: ChangeLogEntry[]
  pendingAsk: { slot: SlotKey; turn: number } | null
  askCounts: Partial<Record<SlotKey, number>>
  stage: 'greeting' | 'slot_filling' | 'clarify' | 'ready' | 'resolved' | 'safety'
  dialogueState: DialogueState
  complaint: ComplaintRecord | null
  complaintMigrated?: boolean
  recentMessages: ChatMessage[]
  recommendations?: RecState
  createdAt: number
  updatedAt: number
}

export interface QuickOption {
  label: string
  target: SlotKey | 'direction'
}

export interface EngineResponse {
  reply: string
  intent: IntentResult
  quickOptions: string[]
  followupQuestions: string[]
  followupTargets: SlotKey[]
  ready: boolean
  stage: SessionContext['stage']
  dialogueState?: SessionContext['dialogueState']
  slotChanges: ChangeLogEntry[]
  compareAction?: { type: 'remove' | 'replace' | 'add'; productId: string; index?: number }
  leadConsent?: 'purchase'
  safety?: {
    safetyLevel: 'none' | 'caution' | 'emergency'
    riskType: 'gas' | 'electric' | 'fire' | 'other' | null
    matchedSignals: string[]
    affectedCategory: string | null
    immediateActions: string[]
    prohibitedActions: string[]
    needsEmergencyHelp: boolean
  }
  kb?: { matchedFaqId: string | null; confidence: 'high' | 'medium' | 'low'; sourceLabel: string }
}

export type PrefKey =
  | 'energy_saving'
  | 'quiet'
  | 'large_capacity'
  | 'easy_operation'
  | 'smart'
  | 'cost_effective'
  | 'durable'
  | 'easy_clean'
  | 'good_service'

export type LocalNeedKey =
  | 'moisture_proof'
  | 'seafood_freezing'
  | 'small_space'
  | 'embedded_installation'
  | 'durable_rental'


export interface SubScore {
  key: string
  label: string
  weight: number
  score: number
  reason: string
  fieldRefs: string[]
}

export interface RecCard {
  productId: string
  category: string
  name: string
  brand: string
  price: number
  totalScore: number
  subScores: SubScore[]
  reasons: string[]
  caveats: string[]
  usedFields: string[]
  usedSlots: string[]
  budgetCeiling?: number
  budgetRatio?: number
  budgetExceed?: number
  sizeFitStatus: '匹配' | '尺寸待确认' | '超限'
  stockStatus: string
}

export interface RecBundle {
  strategy: string
  name: string
  items: RecCard[]
  totalPrice: number
  budgetDiff: number
  compositeScore: number
  allocationText: string
  advantages: string[]
  tradeoffs: string[]
  sizeReminder: string
  pendingInfo: string[]
  portrait: string
}

export interface RecFilterReport {
  totalProductsConsidered: number
  categoryMatched: number
  afterStockFilter: number
  afterBudgetFilter: number
  afterAreaFilter: number
  afterCapacityFilter: number
  afterDimensionFilter: number
  exactMatchCount: number
  primaryConflict: string
}

export interface RecFilterReport {
  totalProductsConsidered: number
  categoryMatched: number
  afterStockFilter: number
  afterBudgetFilter: number
  afterAreaFilter: number
  afterCapacityFilter: number
  afterDimensionFilter: number
  exactMatchCount: number
  primaryConflict: string
}

export interface EmptyResult {
  kind?: 'single_category' | 'multi_category'

  message: string
  categoriesText: string
  filterReport: RecFilterReport
  capacityNote: string
  insight: {
    maxCapacityInBudget: number | null
    suggestedRangeLow: number | null
    suggestedRangeHigh: number | null
    minPriceForSuggested: number | null
  }
  capacityUnit: string
  alternatives: RecCard[]
  relaxationOptions: { label: string; action: 'budget_min' | 'show_nearest' | 'modify' }[]
}

export interface RecState {
  turn: number
  snapshot: string
  stale: boolean
  cards: Record<string, RecCard[]>
  bundles: RecBundle[]
  infeasible: { strategy: string; reason: string }[]
  nearest: { name: string; gaps: string[] } | null
  empty: EmptyResult | null
  candidates: string[]
  candidateInfo: { id: string; name: string; price: number; category: string }[]
  excluded: Record<string, string[]>
}

export type { Category }

