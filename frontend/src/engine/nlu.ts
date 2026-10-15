// 本地混合NLU引擎：文本规范化 + 同义归一 + 字符2/3-gram + TF-IDF 质心统计分类
// 纯本地实现，不调用任何外部模型或API；商品/价格/FAQ答案仍来自结构化数据。
import { NLU_TRAIN } from './nlu-train.ts'
import { ALL_INTENTS } from './types.ts'
import type { IntentKey } from './types.ts'

function normalize(text: string): string {
  let t = text.toLowerCase()
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  t = t.replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  t = t.replace(/[\s，。！？、；：""''（）,.!?;:()~～]+/g, '')
  const SYNONYM: [RegExp, string][] = [
    [/冰箱|冰柜/g, '冰箱'],
    [/洗衣机/g, '洗衣机'],
    [/空调/g, '空调'],
    [/热水器/g, '热水器'],
    [/电视机?/g, '电视'],
    [/洗碗机/g, '洗碗机'],
    [/多少钱|价格|价位|什么价/g, '价格'],
    [/划算|实惠|便宜点|性价比/g, '性价比'],
    [/坏掉|坏了|出故障|有问题|罢工/g, '坏了'],
    [/维修|修一下|售后/g, '维修'],
    [/不满|投诉/g, '投诉'],
    [/送货|发货|物流/g, '送货'],
    [/安装|装一下|上门装/g, '安装'],
    [/想买|打算买|准备买|要买|购入/g, '想买'],
    [/帮我推荐|推荐下|推荐一下|介绍下|介绍一下/g, '推荐'],
    [/省电|节能/g, '省电']
  ]
  for (const [re, to] of SYNONYM) t = t.replace(re, to)
  return t
}

function grams(t: string): Map<string, number> {
  const m = new Map<string, number>()
  const add = (g: string) => m.set(g, (m.get(g) ?? 0) + 1)
  for (let i = 0; i < t.length; i++) {
    if (i + 1 < t.length) add(t.slice(i, i + 2))
    if (i + 2 < t.length) add(t.slice(i, i + 3))
  }
  return m
}

interface Doc {
  intent: IntentKey
  vec: Map<string, number>
  norm: number
  raw: string
}

const docs: Doc[] = []
const docFreq = new Map<string, number>()
let totalDocs = 1
function idfOf(k: string): number {
  return Math.log((totalDocs + 1) / ((docFreq.get(k) ?? 0) + 1)) + 1
}
{
  for (const intent of ALL_INTENTS) {
    const examples = NLU_TRAIN[intent as keyof typeof NLU_TRAIN] ?? []
    const seen = new Set<string>()
    for (const ex of examples) {
      const g = grams(normalize(ex))
      for (const k of g.keys()) {
        if (!seen.has(k)) {
          seen.add(k)
          docFreq.set(k, (docFreq.get(k) ?? 0) + 1)
        }
      }
    }
  }
  totalDocs = Object.values(NLU_TRAIN).reduce((a, b) => a + b.length, 0)
  for (const intent of ALL_INTENTS) {
    const examples = NLU_TRAIN[intent as keyof typeof NLU_TRAIN] ?? []
    for (const ex of examples) {
      const g = grams(normalize(ex))
      const vec = new Map<string, number>()
      for (const [k, tf] of g) {
        vec.set(k, (tf / g.size) * idfOf(k))
      }
      let norm = 0
      for (const v of vec.values()) norm += v * v
      docs.push({ intent: intent as IntentKey, vec, norm: Math.sqrt(norm) || 1, raw: ex })
    }
  }
}

export interface NluResult {
  top1: IntentKey
  top1Score: number
  top2: IntentKey
  top2Score: number
  gap: number
  scores: Record<IntentKey, number>
}

export function _debugDocs(): number { return docs.length }
export function _debugGrams(t: string): string[] { return Array.from(grams(normalize(t)).keys()) }
export function _debugDf(k: string): number { return docFreq.get(k) ?? 0 }
export function _debugDoc(raw: string): [string, number, number][] {
  const d = docs.find((x) => x.raw === raw)
  if (!d) return []
  return Array.from(d.vec.entries()).map(([k, v]) => [k, Math.round(v * 1000) / 1000, Math.round(d.norm * 1000) / 1000])
}
export function _debugSims(text: string): { intent: string; sim: number; raw: string }[] {
  const g = grams(normalize(text))
  let tnorm = 0
  for (const v of g.values()) tnorm += v * v
  tnorm = Math.sqrt(tnorm) || 1
  return docs.map((d) => {
    let dot = 0
    for (const [k, tf] of g) {
      const w = d.vec.get(k)
      if (w) dot += (tf / g.size) * idfOf(k) * w
    }
    return { intent: d.intent, sim: Math.round((dot / (tnorm * d.norm)) * 1000) / 1000, raw: d.raw }
  }).sort((a, b) => b.sim - a.sim).slice(0, 6)
}
const MIN_SIM = 0.008
const K = 6

export function classifyNlu(rawText: string): NluResult {
  const g = grams(normalize(rawText))
  let tnorm = 0
  for (const v of g.values()) tnorm += v * v
  tnorm = Math.sqrt(tnorm) || 1
  const scores = {} as Record<IntentKey, number>
  for (const i of ALL_INTENTS) scores[i as IntentKey] = 0
  // kNN：取最相似的 K 条训练示例，按“最强相似度 + Top3 均值”混合计分，抑制类别样本数偏差
  const sims = docs.map((d) => {
    let dot = 0
    for (const [k, tf] of g) {
      const w = d.vec.get(k)
      if (w) dot += (tf / g.size) * idfOf(k) * w
    }
    return { intent: d.intent, sim: dot / (tnorm * d.norm) }
  }).filter((x) => x.sim >= MIN_SIM).sort((a, b) => b.sim - a.sim)
  const topK = sims.slice(0, K)
  if (topK.length > 0 && topK[0].sim >= 0.03) {
    const byClass: Partial<Record<IntentKey, number[]>> = {}
    for (const { intent, sim } of topK) (byClass[intent] ??= []).push(sim)
    for (const [intent, arr] of Object.entries(byClass)) {
      const s1 = arr[0]
      const avg = arr.reduce((a, b) => a + b, 0) / Math.min(3, arr.length)
      scores[intent as IntentKey] = s1 * 0.5 + avg * 0.5
    }
  }
  // 相似度累加值映射为 0～1 强度：sum>=0.125 视为强信号
  const strength = (v: number) => Math.round(Math.min(1, v * 6) * 1000) / 1000
  const sorted = ALL_INTENTS.map((i) => ({ i: i as IntentKey, s: strength(scores[i as IntentKey] ?? 0) })).sort((a, b) => b.s - a.s)
  return {
    top1: sorted[0].i,
    top1Score: Math.round(sorted[0].s * 1000) / 1000,
    top2: sorted[1].i,
    top2Score: Math.round(sorted[1].s * 1000) / 1000,
    gap: Math.round((sorted[0].s - sorted[1].s) * 1000) / 1000,
    scores
  }
}
