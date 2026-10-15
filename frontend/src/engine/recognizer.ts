import {
  CATEGORY_PATTERNS,
  CITIES,
  CLARIFICATION_QUESTION,
  INTENT_RULES,
  LOCAL_NEED_PATTERNS,
  NEGATION_GUARDS,
  PREF_PATTERNS,
  type LexRule
} from './lexicons.ts'
import { ALL_INTENTS, CONFIDENCE_THRESHOLD, INTENT_PRIORITY } from './types.ts'
import { classifyNlu } from './nlu.ts'
import type { IntentKey, IntentResult, MatchedSignal, SessionContext } from './types.ts'

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function confFromRaw(raw: number): number {
  return round2(Math.min(0.95, raw / (raw + 1)))
}

function isNegated(text: string, label: string): boolean {
  for (const g of NEGATION_GUARDS) {
    if (g.guard.test(text)) {
      for (const drop of g.dropLabels) {
        if (drop.test(label)) return true
      }
    }
  }
  return false
}

export function detectCategories(text: string): string[] {
  const found: string[] = []
  for (const p of CATEGORY_PATTERNS) {
    if (p.re.test(text) && !found.includes(p.category)) found.push(p.category)
  }
  return found
}

// 意图识别：词表/短语规则打分 + 否定保护 + 场景上下文加权 + 优先级消解
export function recognizeIntent(text: string, ctx: SessionContext): IntentResult {
  const t0 = now()
  const signals: MatchedSignal[] = []
  const raw: Record<IntentKey, number> = {
    pre_sale: 0,
    comparison: 0,
    after_sale: 0,
    complaint: 0,
    purchase_intent: 0,
    chitchat_unknown: 0
  }

  for (const intent of ALL_INTENTS) {
    const rules: LexRule[] = INTENT_RULES[intent === 'chitchat_unknown' ? 'chitchat_unknown' : intent]
    for (const rule of rules) {
      if (rule.re.test(text) && !isNegated(text, rule.label)) {
        raw[intent] += rule.weight
        signals.push({ word: rule.label, intent, weight: rule.weight, type: 'pattern' })
      }
    }
  }

  // 场景上下文加权：品类词出现时为相关意图补充置信
  const categories = detectCategories(text)
  if (categories.length > 0) {
    if (raw.pre_sale > 0) {
      raw.pre_sale += 0.5
      signals.push({ word: `品类语境(${categories.join('/')})`, intent: 'pre_sale', weight: 0.5, type: 'context' })
    }
    if (raw.after_sale > 0) {
      raw.after_sale += 0.5
      signals.push({ word: `品类语境(${categories.join('/')})`, intent: 'after_sale', weight: 0.5, type: 'context' })
    }
    if (raw.comparison > 0) {
      raw.comparison += 0.3
      signals.push({ word: `品类语境(${categories.join('/')})`, intent: 'comparison', weight: 0.3, type: 'context' })
    }
  }

  // 明确的双方比较句式 → comparison（确定性短语）
  if (/哪(台|款|个)更(值得|好|划算|推荐|省电|合适)|谁更(好|划算|值得)/.test(text)) {
    raw.comparison += 4
    signals.push({ word: '双方比较句式', intent: 'comparison', weight: 4, type: 'pattern' })
  }

  // 冲突消解：故障 + 已有使用语境时，售后优先于售前（"已经买了但不制冷"）
  if (raw.after_sale > 0 && /已经买|已经买了|用了|买了.{0,4}年|买来/.test(text)) {
    raw.after_sale += 0.5
    signals.push({ word: '已购使用语境', intent: 'after_sale', weight: 0.5, type: 'context' })
  }
  // 质量投诉语境："用了X就坏" 类表达优先投诉
  if (/质量|就坏|一周就|当天就/.test(text) && raw.complaint > 0) {
    raw.complaint += 0.5
    signals.push({ word: '质量投诉语境', intent: 'complaint', weight: 0.5, type: 'context' })
  }

  const hasUpdateCue = /改成|改到|改为|换成|不要了|去掉|删掉|清除|删除|加上|补(充|一下)|不是必须/.test(text)
  const hasContent =
    categories.length > 0 ||
    hasUpdateCue ||
    /[\d一二两三四五六七八九十百千]/.test(text) ||
    CITIES.some((c) => text.includes(c)) ||
    /(宽|深|高|平|米|公分|厘米|口人|个人|口)/.test(text) ||
    Boolean(ctx.pendingAsk) ||
    PREF_PATTERNS.some((p) => p.re.test(text)) ||
    LOCAL_NEED_PATTERNS.some((p) => p.re.test(text)) ||
    raw.pre_sale + raw.comparison + raw.after_sale + raw.complaint + raw.purchase_intent > 0

  let primaryIntent: IntentKey
  let conf: number
  const continuationSignals: MatchedSignal[] = []

  const businessIntents: IntentKey[] = ['pre_sale', 'comparison', 'after_sale', 'complaint', 'purchase_intent']
  const maxBusinessRaw = Math.max(...businessIntents.map((i) => raw[i]))

  // 上下文延续：当前业务意图明确且本轮只是补充条件/修改条件时，归入当前意图
  if (
    ctx.currentIntent &&
    ctx.currentIntent !== 'chitchat_unknown' &&
    (maxBusinessRaw < 1.0 || (hasUpdateCue && raw[ctx.currentIntent] < 1.0) || (/预算|以内|左右|上下|别超|不能超|控制在/.test(text) && raw[ctx.currentIntent] < 4.0)) &&
    hasContent &&
    raw.chitchat_unknown < 1.0
  ) {
    primaryIntent = ctx.currentIntent
    raw[primaryIntent] = Math.max(raw[primaryIntent], 0.8)
    conf = 0.7
    continuationSignals.push({
      word: '当前会话条件补充',
      intent: primaryIntent,
      weight: 0.8,
      type: 'continuation'
    })
  } else {
    // 混合NLU：无上下文延续且规则弱信号时，启用统计语义分类（kNN + 字符2/3-gram TF-IDF）
    const maxBusinessRawElse = Math.max(...businessIntents.map((i) => raw[i]))
    if (maxBusinessRawElse < 1.0) {
      const stat = classifyNlu(text)
      if (stat.top1Score >= 0.3 && stat.gap >= 0.1) {
        raw[stat.top1] += 2.5 * stat.top1Score
        signals.push({ word: `统计语义(${stat.top1})`, intent: stat.top1, weight: 2.5 * stat.top1Score, type: 'statistical' })
      }
    }
    // “推荐/介绍”对象明显非家电时硬抑制售前（避免“推荐个电影”误判）
    if (raw.pre_sale > 0 && /推荐|介绍|求/.test(text) && /电影|歌曲|音乐|书|小说|游戏|餐厅|饭店|景点|礼物|酒店/.test(text)) {
      raw.pre_sale = 0
      signals.push({ word: '无对象推荐抑制', intent: 'pre_sale', weight: -2.6, type: 'context' })
    }
    // 有效性计算 = 原始分 + 优先级加成，同分时高优先级意图胜出
    const eff: Record<IntentKey, number> = { ...raw }
    for (const i of ALL_INTENTS) eff[i] = raw[i] + INTENT_PRIORITY[i] * 0.1
    let winner: IntentKey = 'chitchat_unknown'
    let best = -1
    for (const i of ALL_INTENTS) {
      if (eff[i] > best) {
        best = eff[i]
        winner = i
      }
    }
    primaryIntent = winner
    conf = confFromRaw(eff[winner])
  }

  signals.push(...continuationSignals)

  // 完全无业务信号时归入闲聊/未知，避免优先级加成造成空分类
  if (primaryIntent !== 'chitchat_unknown' && raw[primaryIntent] === 0) {
    primaryIntent = 'chitchat_unknown'
    conf = raw.chitchat_unknown > 0 ? confFromRaw(raw.chitchat_unknown + INTENT_PRIORITY.chitchat_unknown * 0.1) : 0.3
  }

  // 低置信度且无业务锚点（无品类、无闲聊词）：视为未分类，进入澄清
  if (conf < CONFIDENCE_THRESHOLD && primaryIntent !== 'chitchat_unknown' && categories.length === 0 && raw.chitchat_unknown === 0) {
    primaryIntent = 'chitchat_unknown'
  }

  // 模糊开场白：无任何主题对象的"想问问/咨询下"类表达，视为未分类
  if (
    primaryIntent === 'pre_sale' &&
    raw.pre_sale <= 1.5 &&
    categories.length === 0 &&
    !/\d/.test(text) &&
    /(问问|咨询(下|一下)?|想了解|看看)$/.test(text)
  ) {
    primaryIntent = 'chitchat_unknown'
    conf = 0.45
  }

  const needsClarification = conf < CONFIDENCE_THRESHOLD

  // 次要意图：有效分次高且达到最低显著性
  const effAll = ALL_INTENTS.filter((i) => i !== primaryIntent).map((i) => ({
    intent: i,
    eff: raw[i] + INTENT_PRIORITY[i] * 0.1
  }))
  effAll.sort((a, b) => b.eff - a.eff)
  const alternativeIntent = effAll[0] && effAll[0].eff >= 0.8 ? effAll[0].intent : null

  return {
    primaryIntent,
    confidence: conf,
    matchedSignals: signals,
    alternativeIntent,
    needsClarification,
    clarificationQuestion: CLARIFICATION_QUESTION,
    processingTimeMs: round2(now() - t0)
  }
}
