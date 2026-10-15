// 知识库检索模块：关键词/同义表达 + 品类语境 + 安全等级加权，答案与来源可追溯
import type { Faq } from '../types/data.ts'

export interface KbMatch {
  matchedFaqId: string | null
  answer: string
  matchScore: number
  matchedKeywords: string[]
  sourceLabel: string
  safetyLevel: 'high' | 'medium' | 'low'
  confidence: 'high' | 'medium' | 'low'
  alternativeFaqs: { id: string; question: string; score: number }[]
}

const HIGH = 4
const MEDIUM = 2.5

function bigramOverlap(a: string, b: string): number {
  const grams = new Set<string>()
  for (let i = 0; i < a.length - 1; i++) grams.add(a.slice(i, i + 2))
  let hit = 0
  for (let i = 0; i < b.length - 1; i++) {
    if (grams.has(b.slice(i, i + 2))) hit += 1
  }
  return hit
}

export function searchFaq(
  text: string,
  faqs: Faq[],
  opts: { category?: string | null; safetyBoost?: boolean } = {}
): KbMatch {
  const query = text.trim()
  const scored = faqs.map((f) => {
    let score = 0
    const matched: string[] = []
    for (const k of f.keywords) {
      if (query.includes(k)) {
        score += 2
        matched.push(k)
      } else if (k.includes(query) && query.length >= 3) {
        score += 1
        matched.push(k)
      }
    }
    const catMatch = opts.category && (f.applicableCategories.includes(opts.category) || f.applicableCategories.includes('全品类'))
    if (opts.category) score += catMatch ? 2 : -1
    const overlap = Math.min(2, bigramOverlap(query, f.question) * 0.3)
    score += overlap
    if (opts.safetyBoost && f.safetyLevel === 'high') score += 2
    return { faq: f, score: Math.round(score * 100) / 100, matched }
  }).sort((a, b) => b.score - a.score)

  const top = scored[0]
  const confidence = !top || top.score < MEDIUM ? 'low' : top.score >= HIGH ? 'high' : 'medium'
  const alternatives = scored
    .filter((x) => x.faq.id !== top?.faq.id && x.score >= MEDIUM)
    .slice(0, 3)
    .map((x) => ({ id: x.faq.id, question: x.faq.question, score: x.score }))

  if (confidence === 'low') {
    return {
      matchedFaqId: null,
      answer: '',
      matchScore: top ? top.score : 0,
      matchedKeywords: [],
      sourceLabel: '',
      safetyLevel: 'low',
      confidence,
      alternativeFaqs: alternatives
    }
  }

  return {
    matchedFaqId: top.faq.id,
    answer: top.faq.answer,
    matchScore: top.score,
    matchedKeywords: top.matched,
    sourceLabel: `依据 ${top.faq.id} ｜ 模拟知识库`,
    safetyLevel: top.faq.safetyLevel,
    confidence,
    alternativeFaqs: alternatives
  }
}
