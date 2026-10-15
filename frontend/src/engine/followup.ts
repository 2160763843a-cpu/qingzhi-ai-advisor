import { CHITCHAT_DIRECTIONS, HIGH_RISK_FAULT } from './lexicons.ts'
import type { DimEntryLike } from './extractor.ts'
import type { SessionContext, SlotKey } from './types.ts'

export interface FollowupQuestion {
  target: SlotKey
  question: string
  options: string[]
}

const OPTIONS: Record<string, string[]> = {
  categories: ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机'],
  budget: ['3000元以内', '3000-5000元', '5000-8000元', '8000元以上'],
  installationDimensions: ['宽60公分以内', '宽75公分以内', '宽90公分以内', '还不确定'],
  familySize: ['1-2人', '三口之家', '四口之家', '5人以上'],
  preferences: ['节能省电', '静音', '大容量', '性价比高'],
  faultSymptoms: ['不制冷', '不脱水', '漏水', '异响', '不制热'],
  faultDuration: ['刚出现', '一周内', '一个月以上'],
  complaintResolution: ['尽快送达', '上门检测', '退款或换货', '道歉解释'],
  contactWillingness: ['愿意', '暂不需要'],
  purchaseTime: ['这周内', '一个月内', '先了解一下'],
  location: ['青岛市区', '青岛郊区', '其他城市'],
  safetyConfirmed: ['已断电', '已关燃气阀', '还没有']
}

const QUESTIONS: Record<string, string> = {
  categories: '请问您想了解哪类家电？',
  budget: '请问预算大概是多少？',
  installationDimensions: '请问预留位置的宽和深大概是多少（公分或毫米）？',
  familySize: '请问家里几口人使用？',
  preferences: '您更看重哪些方面？比如节能、静音、大容量或性价比？',
  faultSymptoms: '具体是什么故障现象呢？',
  faultDuration: '这个问题出现多久了？',
  complaintResolution: '方便说说具体情况和您希望的处理方式吗？',
  contactWillingness: '是否需要为你登记一条模拟投诉/售后记录（仅本地演示，不会提交给真实企业）？',
  purchaseTime: '请问您希望什么时间安排？',
  location: '请问安装或使用的地址在哪个区域？',
  safetyConfirmed: '为确保安全，请问您已经断电或关闭燃气阀门了吗？'
}

function slots(ctx: SessionContext): Partial<Record<SlotKey, { value: unknown }>> {
  return ctx.slots
}

function dimList(ctx: SessionContext): DimEntryLike[] {
  return (ctx.slots.installationDimensions?.value as DimEntryLike[] | undefined) ?? []
}

export function isReadyForRecommend(ctx: SessionContext): boolean {
  const s = slots(ctx)
  const cats = (s.categories?.value as string[] | undefined) ?? []
  const prefs = (s.preferences?.value as string[] | undefined) ?? []
  const needs = (s.localNeeds?.value as string[] | undefined) ?? []
  const dims = dimList(ctx)
  const hasBudget = Boolean(s.totalBudget || s.totalBudgetMin || s.itemBudget || s.itemBudgetRange || s.itemBudgetByCategory || s.budgetNote)
  const hasSpace = Boolean(dims.length > 0 || s.roomArea || s.houseArea || s.familySize || s.familySizeMin)
  const hasContext = prefs.length > 0 || needs.length > 0 || dims.length > 0
  if (cats.length === 0 || !hasBudget) return false
  if (cats.length >= 2) return hasBudget && dims.length > 0
  return hasSpace && hasContext
}

// 需求完整性判断：信息充分即就绪；关键追问都已问过仍缺非关键信息时，降级为“按已确认条件推荐”
export function readyState(ctx: SessionContext): { ready: boolean; notes: string[] } {
  if (isReadyForRecommend(ctx)) return { ready: true, notes: [] }
  const s = slots(ctx)
  const cats = (s.categories?.value as string[] | undefined) ?? []
  if (!cats.length || ctx.currentIntent !== 'pre_sale') return { ready: false, notes: [] }
  const hasBudget = Boolean(s.totalBudget || s.totalBudgetMin || s.itemBudget || s.itemBudgetRange || s.itemBudgetByCategory || s.budgetNote)
  if (!hasBudget) return { ready: false, notes: [] }
  const prefs = (s.preferences?.value as string[] | undefined) ?? []
  const needs = (s.localNeeds?.value as string[] | undefined) ?? []
  const dims = dimList(ctx)
  const missing: string[] = []
  const hasSpace = dims.length > 0 || s.roomArea || s.houseArea || s.familySize || s.familySizeMin
  if (!hasSpace) missing.push('familySize')
  if (prefs.length === 0 && needs.length === 0) missing.push('preferences')
  if (missing.length === 0) return { ready: false, notes: [] }
  const askCounts = ctx.askCounts as Partial<Record<string, number>>
  const allAsked = missing.every((k) => (askCounts[k] ?? 0) >= 2)
  if (!allAsked) return { ready: false, notes: [] }
  const labels: Record<string, string> = { familySize: '家庭人数', preferences: '偏好' }
  return { ready: true, notes: [`部分信息未确认（${missing.map((m) => labels[m] ?? m).join('、')}），将按已确认条件为你推荐`] }
}

export function computeFollowups(
  ctx: SessionContext,
  currentText: string,
  highRisk: boolean,
  pendingWidth: boolean,
  pendingSlot: SlotKey | null
): FollowupQuestion[] {
  const s = slots(ctx)
  const cats = (s.categories?.value as string[] | undefined) ?? []
  const prefs = (s.preferences?.value as string[] | undefined) ?? []
  const needs = (s.localNeeds?.value as string[] | undefined) ?? []
  const faults = (s.faultSymptoms?.value as string[] | undefined) ?? []
  const dims = dimList(ctx)
  const askCounts = ctx.askCounts as Partial<Record<string, number>>
  const asked = (key: string) => (askCounts[key] ?? 0) >= 2
  const out: FollowupQuestion[] = []

  const add = (target: keyof typeof QUESTIONS) => {
    if (out.length >= 2) return
    if (asked(target)) return
    out.push({ target: target as SlotKey, question: QUESTIONS[target], options: OPTIONS[target] ?? [] })
  }

  // 只记录了宽度：定向追问深度（含跳过选项），最多追问两次
  const dimsNow = dimList(ctx)
  const depthCats = ['冰箱', '洗衣机', '洗碗机']
  const widthOnly = dimsNow.some((d) => d.width !== undefined && d.depth === undefined) && cats.some((c) => depthCats.includes(c))
  if (widthOnly && !s.depthUnknown && !s.dimensionsSkipped && (askCounts.depth ?? 0) < 2) {
    return [{ target: 'installationDimensions' as SlotKey, question: '还需要预留深度；如果暂时不清楚，也可以先跳过，我会在推荐中标注尺寸待确认。', options: ['深60厘米以内', '深70厘米以内', '深80厘米以内', '暂不确定深度'] } as FollowupQuestion]
  }

  // 显式宽度约束但缺少数值：始终追问，不受次数上限约束
  if (pendingWidth) {
    return [{ target: 'installationDimensions', question: QUESTIONS.installationDimensions, options: OPTIONS.installationDimensions }]
  }

  if (highRisk && ctx.currentIntent === 'after_sale') {
    if (!s.safetyConfirmed) add('safetyConfirmed')
    return out
  }

  switch (ctx.currentIntent) {
    case 'pre_sale': {
      if (isReadyForRecommend(ctx)) return []
      const hasBudget = Boolean(s.totalBudget || s.itemBudget || s.itemBudgetRange || s.itemBudgetByCategory)
      if (!cats.length) {
        add('categories')
        return out
      }
      if (!hasBudget) {
        add('budget')
        const hasSpace = dims.length > 0 || s.roomArea || s.houseArea || s.familySize
        if (!hasSpace && out.length < 2) add('familySize')
        return out
      }
      if (cats.length >= 2) {
        add('installationDimensions')
        return out
      }
      const hasSpace2 = dims.length > 0 || s.roomArea || s.houseArea || s.familySize
      if (!hasSpace2) {
        add(s.familySize ? 'installationDimensions' : 'familySize')
        if (prefs.length === 0 && needs.length === 0 && out.length < 2) add('preferences')
        return out
      }
      if (prefs.length === 0 && needs.length === 0) {
        add('preferences')
        return out
      }
      return out
    }
    case 'comparison': {
      if (!cats.length) {
        add('categories')
        return out
      }
      const hasHint = Boolean(
        s.totalBudget || s.itemBudget || s.itemBudgetRange || s.itemBudgetByCategory || s.budgetNote || s.roomArea || s.familySize || /一台.{0,4}\d|一款.{0,4}\d|两款|这几款/.test(currentText)
      )
      if (!hasHint) add('budget')
      return out
    }
    case 'after_sale': {
      if (/保修|保修期/.test(currentText)) return []
      if (!faults.length) {
        add('faultSymptoms')
        return out
      }
      if (!s.faultDuration) {
        add('faultDuration')
        return out
      }
      if (!s.contactIntent) {
        add('contactWillingness')
        return out
      }
      return out
    }
    case 'complaint': {
      if (s.suggestion) return []
      if (!s.complaintResolution) {
        add('complaintResolution')
        return out
      }
      if (!s.contactIntent) {
        add('contactWillingness')
        return out
      }
      return out
    }
    case 'purchase_intent': {
      // 纯咨询式购买话题（无决定性表态且未在追问中）时只陈述，追问
      const decision = /就买|就要|就选|就定|定了|下单|付(款|定金)|决定买|登记|预约|约个|帮我约|安排|留(我)?(个)?电话|给我回复|回复我|什么时候(能)?(送|到|发货|装)/.test(currentText)
      const responding = pendingSlot === 'purchaseTime' || pendingSlot === 'location'
      if (!decision && !s.purchaseTime && !responding) return out
      if (!s.purchaseTime) {
        add('purchaseTime')
        return out
      }
      if (!s.location && (/安装|上门/.test(currentText) || pendingSlot === 'location')) {
        add('location')
        return out
      }
      if (!s.contactIntent) {
        add('contactWillingness')
        return out
      }
      return out
    }
    default:
      return out
  }
}

export { CHITCHAT_DIRECTIONS, HIGH_RISK_FAULT }
