// 购买意向评分：独立、可解释，权重总和恒为100，由真实事件驱动，不用敏感信息加分
import type { SessionContext } from './types.ts'

export const SCORE_WEIGHTS = {
  category: 10,
  budget: 10,
  familyOrSpace: 5,
  purchaseTime: 15,
  recommendationGenerated: 10,
  candidatesAdded: 10,
  comparisonTwoPlus: 10,
  commerceAsk: 10,
  explicitBuy: 15,
  consentGiven: 5
} as const

export const WEIGHTS_TOTAL = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)

export interface ScoreItem { key: string; label: string; score: number; basis: string }
export interface LeadScore { total: number; level: '高' | '中' | '低'; items: ScoreItem[] }

export function levelOf(total: number): '高' | '中' | '低' {
  return total >= 70 ? '高' : total >= 40 ? '中' : '低'
}

export function scorePurchaseLead(
  ctx: SessionContext,
  flags: { explicitBuy?: boolean; commerceAsk?: boolean; consentGiven?: boolean }
): LeadScore {
  const s = ctx.slots
  const cats = (s.categories?.value as string[] | undefined) ?? []
  const hasBudget = Boolean(s.totalBudget || s.totalBudgetMin || s.itemBudget || s.itemBudgetRange || s.itemBudgetByCategory)
  const hasSpace = Boolean(s.familySize || s.familySizeMin || s.houseArea || s.roomArea || (s.installationDimensions?.value as unknown[])?.length)
  const recs = Boolean(ctx.recommendations && Object.values(ctx.recommendations.cards).some((c) => c.length > 0))
  const cand = (ctx.recommendations?.candidates ?? []).length
  const cmp = (ctx.recommendations?.candidates ?? []).length >= 2 || ((ctx as unknown as { comparedPairs?: number }).comparedPairs ?? 0) >= 1
  const items: ScoreItem[] = []
  const push = (key: string, label: string, on: boolean, score: number, basis: string) => {
    if (on) items.push({ key, label, score, basis })
  }
  push('category', '明确目标品类', cats.length > 0, SCORE_WEIGHTS.category, cats.length ? `已记录品类：${cats.join('、')}` : '')
  push('budget', '提供预算', hasBudget, SCORE_WEIGHTS.budget, hasBudget ? '会话中已确认预算条件' : '')
  push('familyOrSpace', '家庭或空间条件', hasSpace, SCORE_WEIGHTS.familyOrSpace, hasSpace ? '已记录家庭人数或安装空间' : '')
  push('purchaseTime', '提供购买时间', Boolean(s.purchaseTime), SCORE_WEIGHTS.purchaseTime, s.purchaseTime ? `期望时间：${String(s.purchaseTime.value)}` : '')
  push('recommendationGenerated', '生成推荐方案', recs, SCORE_WEIGHTS.recommendationGenerated, recs ? '已基于需求生成推荐结果' : '')
  push('candidatesAdded', '加入候选商品', cand > 0, SCORE_WEIGHTS.candidatesAdded, cand > 0 ? `候选 ${cand} 款` : '')
  push('comparisonTwoPlus', '对比两款以上商品', cmp, SCORE_WEIGHTS.comparisonTwoPlus, cmp ? '已进入两款及以上对比' : '')
  push('commerceAsk', '询问价格/库存/配送/安装', Boolean(flags.commerceAsk), SCORE_WEIGHTS.commerceAsk, flags.commerceAsk ? '主动询问价格、库存、配送或安装' : '')
  push('explicitBuy', '明确购买/下单/预约表达', Boolean(flags.explicitBuy), SCORE_WEIGHTS.explicitBuy, flags.explicitBuy ? '出现明确购买或预约表达' : '')
  push('consentGiven', '同意进入联系流程', Boolean(flags.consentGiven), SCORE_WEIGHTS.consentGiven, flags.consentGiven ? '用户主动同意进入联系信息填写' : '')
  const total = Math.min(100, items.reduce((a, b) => a + b.score, 0))
  return { total, level: levelOf(total), items }
}

// 自然语言购买意向识别（结合状态：短回答仅在待授权时有效）
export type PurchaseIntentKind = 'buy' | 'considering' | 'decline' | 'cancel' | null
export function detectPurchaseIntent(text: string, pendingConsent: boolean): PurchaseIntentKind {
  if (/不要联系我了?|取消登记|删除我的信息|不同意继续保存|刚才点错了/.test(text)) return 'cancel'
  // 拒绝联系：必须出现明确的“联系拒绝/不买”语义，仅“再看看”属于仍在考虑
  if (/先别联系|不要联系|别联系|不用找我|暂不需要联系|暂时不买|暂时不.{0,2}买|不着急|先放着|不同意继续保存|不买了吧|先不买/.test(text)) return 'decline'
  if (/(想|准备|打算|最近就要)?买(第[一二三两]|[这那]款|[一两二三四五]台|一台|一套)|就选|就买|就它了?|就要它|帮我下单|下单|预约了解|登记购买|安排人联系|能安排人?联系|现货|安排安装|这周(内)?(买|购)|最近就要买|决定买/.test(text)) return 'buy'
  if (/再看看|先比较|还没决定|过几个月|先了解|有没有|有哪些|多大的|预算|哪款|哪种|什么样的|什么选择/.test(text)) return 'considering'
  if (pendingConsent && /愿意|需要|可以|好|同意|行/.test(text)) return 'buy'
  return null
}

export const CONSENT_PURPOSE_TEXT = '用途：生成竞赛演示用线索或服务记录。数据：称呼（可选）、模拟手机号、期望联系时间（可选）。保存位置：当前浏览器localStorage，不会提交给真实企业或真实工作人员。你可随时查看、导出或删除。'

export const COMMERCE_ASK_RE = /多少钱|有现货|现货吗|什么时候(能)?(送|到|发货)|配送|运费|可以安排安装|能安装|上门安装/
export const EXPLICIT_BUY_RE = /就买|就要|就选|就定|下单|付(款|定金)|决定买|帮我?买|我准备.{0,4}买|最近就要买|这周.{0,2}买/

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`
  return phone.slice(0, 2) + '****'
}
