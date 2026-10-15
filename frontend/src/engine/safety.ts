// SafetyGuard：独立于普通意图识别的安全风险前置拦截
// 设计原则：安全风险判定不依赖意图置信度；否定语义降级；咨询式表达进入谨慎提示而非报警。
import { CATEGORY_PATTERNS } from './lexicons.ts'
import type { Category } from '../types/data.ts'

export type SafetyLevel = 'none' | 'caution' | 'emergency'
export type RiskType = 'gas' | 'electric' | 'fire' | 'other'

export interface SafetyOutcome {
  triggered: boolean
  safetyLevel: SafetyLevel
  riskType: RiskType | null
  matchedSignals: string[]
  affectedCategory: Category | null
  immediateActions: string[]
  prohibitedActions: string[]
  needsEmergencyHelp: boolean
}

interface RiskRule {
  label: string
  re: RegExp
}

const GAS_RULES: RiskRule[] = [
  { label: '有燃气味', re: /有燃气味|闻到燃气味|闻到了燃气味/ },
  { label: '煤气味', re: /煤气味/ },
  { label: '臭鸡蛋味', re: /臭鸡蛋(味|气味)/ },
  { label: '疑似漏气', re: /漏气|好像漏气|似乎漏气|疑似漏气/ },
  { label: '燃气泄漏', re: /燃气泄漏|燃气泄露|煤气泄漏/ },
  { label: '燃气报警器响', re: /燃气报警器(响|报警)|煤气报警器(响|报警)/ },
  { label: '一氧化碳报警', re: /一氧化碳(报警|报警器响|超标)/ }
]

const ELECTRIC_RULES: RiskRule[] = [
  { label: '漏电', re: /漏电|麻手|被电(到|了)|触电|外壳带电|带电/ },
  { label: '插头打火', re: /插头[^。]{0,4}(打火|冒火|火花)/ },
  { label: '打火冒火花', re: /打火(?!机)|冒火花|有火花/ },
  { label: '电线发热', re: /电线(发热|发烫|烫)/ },
  { label: '进水后通电', re: /进水[^。]{0,8}(通电|插电|开机)/ }
]

const FIRE_RULES: RiskRule[] = [
  { label: '冒烟', re: /冒烟|有烟|烟出来了/ },
  { label: '起火', re: /起火|着火|有火|明火/ },
  { label: '火花', re: /冒火花|有火花|打火花/ },
  { label: '烧焦味', re: /烧焦|焦味|糊味|烧糊/ },
  { label: '温度异常升高', re: /温度异常(升高|上升)|外壳(异常|特别|很)烫/ }
]

const OTHER_RULES: RiskRule[] = [
  { label: '热水器爆燃', re: /爆燃/ },
  { label: '异常爆响', re: /爆响|爆炸声/ },
  { label: '外壳严重变形', re: /外壳(严重)?(变形|鼓包)/ },
  { label: '漏水接近电源', re: /漏水[^。]{0,12}(电源|插座|插线板|带电)/ }
]

const ALL_RULES: { type: RiskType; rules: RiskRule[] }[] = [
  { type: 'fire', rules: FIRE_RULES },
  { type: 'gas', rules: GAS_RULES },
  { type: 'electric', rules: ELECTRIC_RULES },
  { type: 'other', rules: OTHER_RULES }
]

const INQUIRY_RE = /怎么判断|如何判断|怎么知道|如何知道|怎么检查|如何检查|会不会(漏|有)|是否(漏|有)|有没有可能|什么情况(算|属于)/
const NEGATION_RE = /(没|没有|无|未|不是|不算)[^。]{0,6}$/
const REAFFIRM_RE = /现在还有|还有|仍然|依旧|又(有|出现)/

function isNegated(text: string, index: number): boolean {
  const head = text.slice(Math.max(0, index - 8), index)
  return NEGATION_RE.test(head)
}

const ACTIONS: Record<RiskType, { immediate: string[]; prohibited: string[] }> = {
  gas: {
    immediate: [
      '不要使用明火，不要操作可能产生火花的电器开关',
      '在确保安全的情况下开窗通风，并关闭燃气阀门',
      '尽快离开危险区域',
      '联系当地燃气公司或专业人员上门处理'
    ],
    prohibited: ['不要使用明火', '不要开关任何电器或打火', '不要自行拆修燃气部件', '不要在现场拨打手机（先撤离到安全区域后再求助）']
  },
  electric: {
    immediate: [
      '立即停止使用设备',
      '不要用湿手触碰设备或开关',
      '在确保安全的情况下切断电源（拔掉插头或关闭断路器）',
      '联系专业电工或售后人员检查'
    ],
    prohibited: ['不要用湿手操作', '不要继续通电试机', '不要自行拆机检修']
  },
  fire: {
    immediate: [
      '立即停止使用并远离设备',
      '在确保安全的情况下切断电源或气源',
      '有明火或危险扩大时，立即撤离并拨打紧急救援电话'
    ],
    prohibited: ['不要继续试机', '不要自行拆修', '不要冒险自行扑救']
  },
  other: {
    immediate: [
      '立即停止使用并远离设备',
      '在确保安全的情况下切断电源或气源',
      '联系专业人员上门检查'
    ],
    prohibited: ['不要再次通电或通气试机', '不要自行拆修']
  }
}

const RISK_LABEL: Record<RiskType, string> = {
  gas: '燃气泄漏',
  electric: '漏电触电',
  fire: '冒烟起火',
  other: '设备异常'
}

export function detectSafety(text: string): SafetyOutcome {
  const outcome: SafetyOutcome = {
    triggered: false,
    safetyLevel: 'none',
    riskType: null,
    matchedSignals: [],
    affectedCategory: null,
    immediateActions: [],
    prohibitedActions: [],
    needsEmergencyHelp: false
  }
  if (!text) return outcome

  const inquiry = INQUIRY_RE.test(text)
  const reaffirm = REAFFIRM_RE.test(text)
  const categoryMatch = CATEGORY_PATTERNS.find((p) => p.re.test(text))
  if (categoryMatch) outcome.affectedCategory = categoryMatch.category as Category
  if (outcome.affectedCategory === null && /燃气|煤气/.test(text)) outcome.affectedCategory = '热水器' as Category

  let best: { type: RiskType; label: string; level: 'emergency' | 'caution' } | null = null
  const signals: string[] = []
  const severities: Record<RiskType, number> = { fire: 4, gas: 3, electric: 2, other: 1 }

  for (const group of ALL_RULES) {
    for (const rule of group.rules) {
      const m = text.match(rule.re)
      if (!m) continue
      const idx = m.index ?? 0
      const negated = isNegated(text, idx) && !reaffirm
      signals.push(negated ? `${rule.label}（否定）` : rule.label)
      if (negated) continue
      const level: 'emergency' | 'caution' = inquiry && group.type !== 'fire' ? 'caution' : 'emergency'
      const cand = { type: group.type, label: rule.label, level }
      if (!best || (level === 'emergency' && best.level !== 'emergency') || (level === best.level && severities[group.type] >= severities[best.type])) {
        if (!best || (best.level === 'caution' && level === 'emergency') || severities[group.type] >= severities[best.type]) {
          best = cand
        }
      }
    }
  }
  outcome.matchedSignals = signals

  if (!best) {
    if (inquiry && signals.length > 0) {
      outcome.triggered = true
      outcome.safetyLevel = 'caution'
      outcome.riskType = 'other'
      outcome.affectedCategory = outcome.affectedCategory ?? '热水器'
    }
    return outcome
  }

  outcome.triggered = true
  outcome.riskType = best.type
  if (!outcome.affectedCategory && best.type === 'gas') outcome.affectedCategory = '热水器'
  outcome.matchedSignals = Array.from(new Set(signals))

  if (best.level === 'caution') {
    outcome.safetyLevel = 'caution'
    outcome.immediateActions = ['请以产品说明书与官方安全指引为准', '如闻到燃气味、看到冒烟或感到麻手，请立即停止使用并撤离，联系专业人员']
    outcome.prohibitedActions = ['在确认安全前，请勿自行拆修或继续通电/通气试机']
    outcome.needsEmergencyHelp = false
    return outcome
  }

  outcome.safetyLevel = 'emergency'
  outcome.immediateActions = ACTIONS[best.type].immediate
  outcome.prohibitedActions = ACTIONS[best.type].prohibited
  outcome.needsEmergencyHelp = best.type === 'fire' || /起火|着火|明火|爆燃|爆炸/.test(text)
  return outcome
}

export function safetyAlertText(s: SafetyOutcome, categoryText: string): string {
  const lines: string[] = []
  lines.push(`【安全提醒｜请立即处理】检测到疑似${RISK_LABEL[s.riskType as RiskType]}风险${categoryText ? `（${categoryText}）` : ''}。`)
  lines.push('请立即：')
  s.immediateActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`))
  lines.push('切勿：')
  s.prohibitedActions.forEach((a) => lines.push(`- ${a}`))
  if (s.needsEmergencyHelp) lines.push('如已起火或危险正在扩大，请立即撤离现场并拨打紧急救援电话。')
  lines.push('在确保安全之前，我不会继续进行商品推荐或其他咨询。')
  return lines.join('\n')
}

export function safetyCautionText(s: SafetyOutcome): string {
  return `【安全提示】你提到了${RISK_LABEL[s.riskType as RiskType]}相关话题：涉及安全的问题请以官方指引为准，如遇紧急情况请先停止使用、撤离并联系专业人员。\n`
}
