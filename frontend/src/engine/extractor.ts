import {
  CATEGORY_PATTERNS,
  CATEGORY_REMOVE,
  CITIES,
  HIGH_RISK_FAULT,
  LOCAL_NEED_PATTERNS,
  PREF_PATTERNS,
  PREF_REMOVE
} from './lexicons.ts'
import { localNeedLabel, prefLabel } from './labels.ts'
import type { IntentResult, SessionContext, SlotKey } from './types.ts'

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}

// 中文数字解析（支持 1-9999：十四、二十、二十五、三千、两万）
function cnToInt(raw: string | undefined | null): number | null {
  if (!raw) return null
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw)
  let total = 0
  let section = 0
  let current = 0
  for (const ch of raw) {
    if (CN_DIGITS[ch] !== undefined) {
      current = CN_DIGITS[ch]
    } else if (ch === '十') {
      section += (current === 0 ? 1 : current) * 10
      current = 0
    } else if (ch === '百') {
      section += (current === 0 ? 1 : current) * 100
      current = 0
    } else if (ch === '千') {
      section += (current === 0 ? 1 : current) * 1000
      current = 0
    } else if (ch === '万') {
      total = (total + section + current) * 10000
      section = 0
      current = 0
    } else {
      return null
    }
  }
  return total + section + current
}

function sanitizeRaw(raw: string): string {
  return raw.replace(/1[3-9]\d{9}/g, (m) => `${m.slice(0, 3)}****${m.slice(7)}`)
}

const NUM = '(?:[0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十百千]+)'
const CAP_NUM = `(${NUM})`

interface MoneyCandidate {
  amount: number | null
  range: { min?: number; max?: number } | null
  isTotal: boolean
  index: number
  matched: string
}

function classifyBudget(total: boolean, ctx: SessionContext): 'total' | 'item' {
  if (total) return 'total'
  const cats = (ctx.slots.categories?.value as string[] | undefined) ?? []
  if (cats.length >= 2) return 'total'
  return 'item'
}

function extractMoney(text: string, ctx: SessionContext, intent: IntentResult): MoneyCandidate[] {
  const out: MoneyCandidate[] = []
  // 投诉语境不提取预算（金额多为争议费用），对比句中的多台报价也不作为预算
  if (intent.primaryIntent === 'complaint') return out
  if (/一台.{0,12}一台|一款.{0,12}一款/.test(text)) return out
  if (/花了|被收|收费|罚款|赔偿金/.test(text)) return out

  const totalCue = /总预算|预算总|一共|总共|合计|两件|三件|全套|组合|套餐|一起买/.test(text)
  const isModify = /改成|改到|改为|换成/.test(text)
  const hasTotalBefore = Boolean(ctx.slots.totalBudget)

  // 模糊区间："预算四五千" → 4000-5000（双汉字数字 + 千 的口语形态）
  const fuzzyK = text.match(new RegExp(`预算[^0-9千]{0,2}([一二两三四五六七八九])([一二两三四五六七八九十])千(?:多|吧|左右|上下)?`))
  if (fuzzyK) {
    const n = cnToInt(fuzzyK[1]) ?? 0
    out.push({ amount: null, range: { min: n * 1000, max: (n + 1) * 1000 }, isTotal: totalCue || (isModify && hasTotalBefore), index: fuzzyK.index ?? 0, matched: fuzzyK[0] })
    return out
  }

  const cnMoney = new RegExp(`(?:预算|价位|价格|花)[^0-9一二两三四五六七八九十百千]{0,3}${CAP_NUM}\\s*(万元?|千|块(钱)?|元)?\\s*(以内|左右|上下|多)?`)
  const cnM = text.match(cnMoney)
  if (cnM && !/[0-9]/.test(cnM[1])) {
    const base = cnToInt(cnM[1]) ?? 0
    const amount = cnM[2] === '万' || cnM[2] === '万元' ? base * 10000 : cnM[2] === '千' ? base * 1000 : base
    if (amount >= 100) {
      out.push({ amount, range: null, isTotal: totalCue || (isModify && hasTotalBefore), index: cnM.index ?? 0, matched: cnM[0] })
      return out
    }
  }

  // 区间预算：3000到4000 / 3000-4000 / 2000多
  const rangeRe = new RegExp(`(?:预算[^0-9]{0,4})?(\\d{3,5})\\s*(?:到|至|-|~|—)\\s*(\\d{3,5})\\s*(万元?|块(钱)?|元)?\\s*(以内|左右|上下)?`)
  const rm = text.match(rangeRe)
  if (rm && (rm[5] || rm[3] || /预算/.test(rm[0]))) {
    out.push({
      amount: null,
      range: { min: Number(rm[1]), max: Number(rm[2]) },
      isTotal: totalCue || (isModify && hasTotalBefore),
      index: rm.index ?? 0,
      matched: rm[0]
    })
    return out
  }
  const duoRe = /(?:预算|价格|价位)[^0-9]{0,3}(\d{3,5})\s*多/
  const dm = text.match(duoRe)
  if (dm) {
    const n = Number(dm[1])
    out.push({ amount: null, range: { min: n, max: n + 1000 }, isTotal: totalCue || (isModify && hasTotalBefore), index: dm.index ?? 0, matched: dm[0] })
    return out
  }

  // “3000元起”
  const yuanQi = text.match(/(\d{3,5})\s*元起/)
  if (yuanQi) {
    const n = Number(yuanQi[1])
    if (n >= 100) {
      out.push({ amount: null, range: { min: n, max: undefined }, isTotal: totalCue || (isModify && hasTotalBefore), index: yuanQi.index ?? 0, matched: yuanQi[0] })
      return out
    }
  }

  // “一万多”：合理模糊区间并向用户确认
  const wanDuo = text.match(/([一两二三四五1-5])万(多|把|左右|上下)/)
  if (wanDuo) {
    const n = /[0-9]/.test(wanDuo[1]) ? Number(wanDuo[1]) : cnToInt(wanDuo[1]) ?? 0
    if (n >= 1) {
      out.push({ amount: null, range: { min: n * 10000, max: n * 10000 + 5000 }, isTotal: totalCue || (isModify && hasTotalBefore), index: wanDuo.index ?? 0, matched: wanDuo[0] })
      return out
    }
  }

  // 下限预算："至少5000元 / 10000元以上 / 一万往上 / 3000元起"
  const minCue = text.match(new RegExp(`(?:至少|起码)\\s*${CAP_NUM}\\s*(万元?|块(钱)?|元)?|(\\d{3,5})\\s*(万元?|块(钱)?|元)?\\s*(以上|往上|起步)|([一二两三四五六七八九]+)\\s*万?\\s*(以上|往上)`))
  if (minCue) {
    let n: number | null = null
    if (minCue[4]) n = Number(minCue[4]) * (/万/.test(minCue[5] ?? '') ? 10000 : 1)
    else if (minCue[8]) n = (cnToInt(minCue[8]) ?? 0) * (/万/.test(minCue[0]) ? 10000 : 1)
    else {
      const base = cnToInt(minCue[1]) ?? Number(minCue[1])
      const unit = minCue[2] ?? ''
      n = unit.startsWith('万') ? base * 10000 : unit.startsWith('千') ? base * 1000 : base
    }
    if (n && n >= 100) {
      out.push({ amount: null, range: { min: n, max: undefined }, isTotal: totalCue || (isModify && hasTotalBefore), index: minCue.index ?? 0, matched: minCue[0] })
      return out
    }
  }

  // 单值预算：需货币后缀或"预算/价位/价格"前缀或"以内/左右/上下"后缀
  const singleRe = new RegExp(`(预算|价位|价格)?[^0-9]{0,2}(\\d{3,5})\\s*(万元?|块(钱)?|元)?\\s*(以内|左右|上下)?`)
  const sm = text.match(singleRe)
  if (sm) {
    const hasCurrency = Boolean(sm[3])
    const hasPrefix = sm[1] === '预算' || sm[1] === '价位' || sm[1] === '价格'
    const hasSuffix = Boolean(sm[5])
    if ((hasCurrency || hasPrefix || hasSuffix) && !/平|口人|个人|匹|套|升|公斤|年|米/.test(sm[0])) {
      out.push({
        amount: Number(sm[2]) * (sm[3] === '万' || sm[3] === '万元' ? 10000 : 1),
        range: null,
        isTotal: totalCue || (isModify && hasTotalBefore),
        index: sm.index ?? 0,
        matched: sm[0]
      })
    }
  }
  return out
}

interface DimParsed {
  width?: number
  depth?: number
  height?: number
  unit: string
  location?: string
}

const LOCATIONS = ['厨房', '阳台', '客厅', '卧室', '餐厅', '书房', '卫生间', '墙面', '预留位', '位置']

function parseDimsInSegment(segment: string): DimParsed | null {
  const unitFor = (u: string | undefined, v: number): string => {
    if (u) return u
    return v >= 100 ? 'mm' : 'cm'
  }
  let location: string | undefined
  for (const loc of LOCATIONS) {
    if (segment.includes(loc)) {
      location = loc
      break
    }
  }
  let width: number | undefined
  let depth: number | undefined
  let height: number | undefined
  let unit = 'mm'

  const wm = segment.match(new RegExp(`宽(?:度)?[^0-9]{0,3}(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|公分|厘米|cm|米|m)?`))
  if (wm) {
    width = Number(wm[1])
    unit = unitFor(wm[2], width)
  }
  const wmRev = segment.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(米|m)\\s*宽`))
  if (!width && wmRev) {
    width = Number(wmRev[1])
    unit = wmRev[2] === 'm' ? '米' : '米'
  }
  const dm = segment.match(new RegExp(`深(?:度)?[^0-9]{0,3}(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|公分|厘米|cm|米|m)?`))
  if (dm) {
    depth = Number(dm[1])
    unit = unitFor(dm[2], depth)
  }
  const hm = segment.match(new RegExp(`高(?:度)?[^0-9]{0,3}(\\d+(?:\\.\\d+)?)\\s*(毫米|mm|公分|厘米|cm|米|m)?`))
  if (hm) {
    height = Number(hm[1])
    unit = unitFor(hm[2], height)
  }
  if (width === undefined && depth === undefined && height === undefined) return null
  return { width, depth, height, unit, location }
}

const FAULT_SURFACE: { re: RegExp; name: string }[] = [
  { re: /不制冷|制冷差/, name: '不制冷' },
  { re: /不制热/, name: '不制热' },
  { re: /不脱水/, name: '不脱水' },
  { re: /不进水/, name: '不进水' },
  { re: /不出水/, name: '不出水' },
  { re: /漏水|滴水/, name: '漏水' },
  { re: /漏电|麻手|触电/, name: '漏电' },
  { re: /跳闸/, name: '跳闸' },
  { re: /漏氟/, name: '漏氟' },
  { re: /异响/, name: '异响' },
  { re: /噪音(特别)?大|声音(特别)?大|太吵/, name: '噪音大' },
  { re: /花屏/, name: '花屏' },
  { re: /黑屏/, name: '黑屏' },
  { re: /冒烟/, name: '冒烟' },
  { re: /烧焦|焦味/, name: '烧焦味' },
  { re: /异味/, name: '异味' },
  { re: /打不着火|不点火|打不起火/, name: '打不着火' },
  { re: /结冰|结霜/, name: '结冰结霜' },
  { re: /遥控(器)?失灵|遥控没反应/, name: '遥控失灵' },
  { re: /没反应|不启动|打不开|死机|卡死/, name: '无法启动' }
]

export interface SlotUpdate {
  key: SlotKey
  mode: 'set' | 'update' | 'merge' | 'remove-item' | 'delete-slot'
  value: unknown
  detail: string
}

export function extractSlots(
  text: string,
  ctx: SessionContext,
  intent: IntentResult,
  turn: number
): SlotUpdate[] {
  const updates: SlotUpdate[] = []
  const push = (key: SlotKey, mode: SlotUpdate['mode'], value: unknown, detail: string) =>
    updates.push({ key, mode, value, detail })

  // ---- 品类（可多选，可移除） ----
  const removed: string[] = []
  for (const r of CATEGORY_REMOVE) {
    const m = text.match(r.re)
    if (m) {
      const cat = m[1] || m[2]
      if (cat && !removed.includes(cat)) removed.push(cat)
    }
  }
  const detected = CATEGORY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.category)
  const currentCats = (ctx.slots.categories?.value as string[] | undefined) ?? []
  const addCats = detected.filter((c) => !currentCats.includes(c) && !removed.includes(c))
  const kept = currentCats.filter((c) => !removed.includes(c))
  const nextCats = Array.from(new Set([...kept, ...addCats]))
  if (removed.length > 0) {
    push('categories', 'remove-item', nextCats, `已从需求中移除：${removed.join('、')}`)
  } else if (addCats.length > 0) {
    push('categories', nextCats.length > addCats.length ? 'merge' : 'set', nextCats, `已记录关注品类：${nextCats.join('、')}`)
  }

  // ---- 预算特殊语义：价格非首要条件 / 无上限 / 性价比偏好 ----
  if (/钱不是问题|价格无所谓|预算不限|不差钱|价格不是问题/.test(text)) {
    push('budgetNote', 'set', '价格非首要条件', '已记录价格非首要条件，不为预算虚构具体数字')
  } else if (/预算没有上限|没有上限|不设上限|预算无上限/.test(text)) {
    push('budgetNote', 'set', '预算无上限', '已记录预算无上限，不设置虚构数字')
  }

  // ---- 预算（区分总预算与单品预算，支持修改） ----
  const moneys = extractMoney(text, ctx, intent)
  if (moneys.length > 0) {
    const m = moneys[0]
    const kind = classifyBudget(m.isTotal, ctx)
    const isModify = /改成|改到|改为|换成/.test(text)
    if (kind === 'total') {
      const prevRaw = ctx.slots.totalBudget?.value as unknown
      const prev = typeof prevRaw === 'number' ? prevRaw : (prevRaw as { max?: number } | undefined)?.max
      const rangeVal = m.range && m.range.max !== undefined ? { min: m.range.min, max: m.range.max } : undefined
      push(
        'totalBudget',
        prevRaw !== undefined ? 'update' : 'set',
        rangeVal ?? m.amount,
        rangeVal ? `总预算已记录为 ${rangeVal.min}～${rangeVal.max} 元` : isModify && prev ? `预算已由 ${prev} 元调整为 ${m.amount} 元` : `总预算已记录为 ${m.amount} 元`
      )
    } else {
      const cats = (ctx.slots.categories?.value as string[] | undefined) ?? []
      if (m.range) {
        const catsNow = (ctx.slots.categories?.value as string[] | undefined) ?? []
        const label = catsNow.length === 1 ? `${catsNow[0]}` : '单品'
        const fuzzyConfirm = /(多|把)/.test(m.matched)
        const detail = m.range.max === undefined
          ? `${label}预算下限已记录为 ${m.range.min} 元`
          : fuzzyConfirm
            ? `${label}预算约 ${m.range.min}～${m.range.max} 元（如不准确请告诉我）`
            : `${label}预算区间已记录为 ${m.range.min}～${m.range.max} 元`
        push('itemBudgetRange', ctx.slots.itemBudgetRange ? 'update' : 'set', m.range, detail)
      } else if (m.amount !== null) {
        // 单品类只保留一条预算记录，避免重复文案；"每件/每台"明确表述时使用单品预算上限措辞
        const perItemWording = /每[件台]/.test(text)
        const approxCue = /(左右|上下|大概|大约)/.test(m.matched)
        const strictMaxCue = /(不超过|别超过|不能超过|最多)/.test(text)
        const prefix = approxCue ? '约 ' : ''
        const suffix = strictMaxCue ? '（不超过）' : ''
        if (cats.length === 1) {
          const label = perItemWording ? `${cats[0]}单品预算上限` : `${cats[0]}预算上限`
          push('itemBudgetByCategory', 'merge', { [cats[0]]: m.amount }, `${label}已记录为 ${prefix}${m.amount} 元${suffix}`)
        } else {
          const label = perItemWording ? '单品预算上限' : '单品预算'
          push('itemBudget', ctx.slots.itemBudget ? 'update' : 'set', m.amount, isModify ? `${label}已调整为 ${prefix}${m.amount} 元${suffix}` : `${label}已记录为 ${prefix}${m.amount} 元${suffix}`)
        }
      }
    }
  }

  // ---- 深度选项与跳过 ----
  const dmOpt = text.match(/深\s*(\d{2,3})\s*(厘米|公分|mm|毫米)?\s*(以内)?/)
  if (dmOpt) {
    const d = Number(dmOpt[1])
    const unit = dmOpt[2] === '毫米' || dmOpt[2] === 'mm' ? 'mm' : 'cm'
    const dimsNow2 = (((ctx.slots.installationDimensions?.value as DimEntryLike[] | undefined) ?? []) as DimEntryLike[]).slice()
    const w = dimsNow2.length > 0 ? dimsNow2[dimsNow2.length - 1].width : undefined
    const entry = { width: w, depth: unit === 'mm' ? d : d * 10, unit: unit === 'mm' ? 'mm' : 'cm', location: dimsNow2.length > 0 ? dimsNow2[dimsNow2.length - 1].location : undefined } as never
    if (dimsNow2.length > 0) dimsNow2[dimsNow2.length - 1] = entry
    else dimsNow2.push(entry as never)
    push('installationDimensions', ctx.slots.installationDimensions ? 'update' : 'set', dimsNow2, `已记录深度不超过 ${d} 厘米`)
  } else if (/暂不确定深度|还不确定尺寸|暂时不清楚/.test(text)) {
    push('depthUnknown', 'set', true, '深度暂不确定：推荐将标注“安装尺寸待确认”')
  }

  // ---- 家庭人数下限："5人以上 / 5人及以上 / 五口以上" ----
  const famMinPatterns = [
    new RegExp(`${CAP_NUM}\\s*人(以上|及以上)`),
    new RegExp(`${CAP_NUM}\\s*口(以上|及以上)`),
    new RegExp(`${CAP_NUM}\\s*个人(以上|多)`),
    new RegExp(`超过\\s*${CAP_NUM}\\s*人`)
  ]
  for (const re of famMinPatterns) {
    const fm = text.match(re)
    if (fm) {
      const n = cnToInt(fm[1])
      if (n && n >= 1 && n <= 12) {
        push('familySizeMin', ctx.slots.familySizeMin ? 'update' : 'set', n, `家庭人数要求已记录为 ${n} 人及以上`)
        break
      }
    }
  }

  // ---- 家庭人数（分支正则逐个尝试，保证捕获组编号稳定） ----
  const famPatterns = [
    new RegExp(`${CAP_NUM}\\s*口之家`),
    new RegExp(`一家\\s*${CAP_NUM}\\s*口`),
    new RegExp(`${CAP_NUM}\\s*口人`),
    new RegExp(`${CAP_NUM}\\s*个人`)
  ]
  let fam: RegExpMatchArray | null = null
  for (const re of famPatterns) {
    fam = text.match(re)
    if (fam) break
  }
  if (fam) {
    const n = cnToInt(fam[1])
    if (n && n >= 1 && n <= 12) {
      push('familySize', ctx.slots.familySize ? 'update' : 'set', n, `家庭人数已记录为 ${n} 人`)
    }
  }

  // ---- 面积（房间面积 / 住房面积） ----
  const areaRe = new RegExp(`${CAP_NUM}\\s*(平方米|平米|㎡|平方|平)`)
  const am = text.match(areaRe)
  if (am) {
    const n = cnToInt(am[1])
    if (n && n >= 3 && n <= 500) {
      const isHouse = /房(?:子)?|住房|住宅|家里/.test(text) && !/卧室|客厅|房间|主卧|次卧|书房/.test(text)
      const key: SlotKey = isHouse ? 'houseArea' : 'roomArea'
      push(key, ctx.slots[key] ? 'update' : 'set', n, `${isHouse ? '住房' : '房间'}面积已记录为 ${n} ㎡`)
    }
  }

  // ---- 安装空间尺寸（宽/深/高，支持单位与位置归属） ----
  const segments = text.split(/[，,；;\n]/)
  const dims: DimParsed[] = []
  for (const seg of segments) {
    const parsed = parseDimsInSegment(seg)
    if (parsed) dims.push(parsed)
  }
  if (dims.length > 0) {
    const prev = (ctx.slots.installationDimensions?.value as DimEntryLike[] | undefined) ?? []
    const merged: DimEntryLike[] = [...prev]
    for (const d of dims) {
      const idx = d.location ? merged.findIndex((e) => e.location === d.location) : -1
      const entry = { ...d, turn }
      if (idx >= 0) merged[idx] = { ...merged[idx], ...entry }
      else merged.push(entry)
    }
    push(
      'installationDimensions',
      prev.length > 0 ? 'update' : 'set',
      merged,
      dims.map((d) => `${d.location ?? '安装'}位安装空间已记录为 ${[d.width && `宽${d.width}`, d.depth && `深${d.depth}`, d.height && `高${d.height}`].filter(Boolean).join('×')} ${d.unit}`).join('；')
    )
  }
  const pendingWidth = /宽(?:度)?[^。\d]{0,10}(不能超过|不超过|不超过预留|预留)/.test(text)
  if (pendingWidth) {
    push('__pendingWidth' as SlotKey, 'set', 'width', '提到宽度约束但缺少具体数值')
  }

  // ---- 尺寸限制取消："宽度不限 / 尺寸没有限制" ----
  if (/(尺寸|宽度|深度|高度|预留)[^。]{0,6}(不限|没有限制|无限制|不限制了)/.test(text)) {
    push('installationDimensions', 'delete-slot', null, '已取消安装尺寸限制')
  }

  // ---- 城市 ----
  for (const city of CITIES) {
    if (text.includes(city)) {
      push('location', ctx.slots.location ? 'update' : 'set', city, `所在城市已记录为${city}`)
      break
    }
  }

  // ---- 偏好（按分句处理：肯定句与否定句互不干扰） ----
  const prefs = (((ctx.slots.preferences?.value as string[] | undefined) ?? []) as string[]).slice()
  const prefAdded: string[] = []
  const prefRemoved: string[] = []
  const clauses = text.split(/[，。,；;]+/).filter(Boolean)
  for (const cl of clauses) {
    const negated = PREF_REMOVE.some((re) => re.test(cl))
    for (const p of PREF_PATTERNS) {
      if (!p.re.test(cl)) continue
      const idx = prefs.indexOf(p.key)
      if (negated) {
        if (idx >= 0) {
          prefs.splice(idx, 1)
          prefRemoved.push(prefLabel(p.key))
        }
      } else if (idx < 0) {
        prefs.push(p.key)
        prefAdded.push(prefLabel(p.key))
      }
    }
  }
  const prefDetail = [
    prefAdded.length > 0 ? `已将${prefAdded.join('、')}作为优先考虑条件` : '',
    prefRemoved.length > 0 ? `已从偏好中移除${prefRemoved.join('、')}` : ''
  ].filter(Boolean).join('；')
  if (prefDetail) {
    push('preferences', 'merge', prefs, prefDetail)
  }

  // ---- 本地化需求 ----
  const needs = (((ctx.slots.localNeeds?.value as string[] | undefined) ?? []) as string[]).slice()
  const needAdded: string[] = []
  for (const p of LOCAL_NEED_PATTERNS) {
    if (p.re.test(text) && !needs.includes(p.key)) {
      needs.push(p.key)
      needAdded.push(localNeedLabel(p.key))
    }
  }
  if (needAdded.length > 0) {
    push('localNeeds', 'merge', needs, `已记录本地需求：${needAdded.join('、')}`)
  }

  // ---- 故障现象 ----
  const faults = (((ctx.slots.faultSymptoms?.value as string[] | undefined) ?? []) as string[]).slice()
  const newFaults: string[] = []
  for (const f of FAULT_SURFACE) {
    if (f.re.test(text) && !faults.includes(f.name)) {
      faults.push(f.name)
      newFaults.push(f.name)
    }
  }
  if (newFaults.length > 0) {
    push('faultSymptoms', 'merge', faults, `已记录故障现象：${newFaults.join('、')}`)
  }

  // ---- 已用年限 ----
  const owned = text.match(new RegExp(`(?:用了|使用|买了|购买|买)(?:了)?\\s*${CAP_NUM}\\s*年`))
  if (owned) {
    const n = cnToInt(owned[1])
    if (n && n >= 1 && n <= 30) {
      push('ownedDuration', ctx.slots.ownedDuration ? 'update' : 'set', `${n}年`, `已记录使用年限：约 ${n} 年`)
    }
  }

  // ---- 期望时间 ----
  const timeRe =
    /(今天|明天|后天|本周|这周|下周|周末|周六|周日|星期[一二三四五六日天]|工作日|白天|晚上|上午|中午|下午|月底|年底|下个?月|本月|双十一|春节|五一|国庆)(周?[上下]午)?/
  const tmAll = text.match(new RegExp(timeRe.source, 'g'))
  if (tmAll && intent.primaryIntent === 'purchase_intent') {
    const phrase = tmAll.join('')
    push('purchaseTime', ctx.slots.purchaseTime ? 'update' : 'set', phrase.trim(), `期望时间已记录为${phrase.trim()}`)
  }

  // ---- 联系/预约意愿（仅记录意愿布尔值，本轮不采集联系方式） ----
  const pendingConsent = ctx.pendingAsk?.slot === ('contactWillingness' as SlotKey)
  if (
    /联系我|打电话|回电|留(我)?(个)?电话|我的电话|联系方式|给我回复|回复我|预约|登记|下单/.test(text) ||
    (pendingConsent && /愿意|需要|可以|好|行|同意|暂不需要|不需要|先不用|不用|算了|不要联系/.test(text)) ||
    intent.primaryIntent === 'purchase_intent'
  ) {
    if (!ctx.slots.contactIntent || ctx.slots.contactIntent.value !== true) {
      push('contactIntent', 'set', true, '已记录您的联系/预约意愿')
    }
  }

  // ---- 投诉主题 / 订单号 / 建议 ----
  if (intent.primaryIntent === 'complaint') {
    let topic: string | null = null
    if (/送货|物流|还没(到|送)|拖了|迟迟|延迟/.test(text)) topic = '送货延迟'
    else if (/安装|师傅|辅材|乱收费|被收|多收/.test(text)) topic = '安装收费争议'
    else if (/噪音|太吵|吵得|声音大/.test(text)) topic = '噪音大'
    else if (/没人回复|响应|态度|没处理|不处理|没人接|打不通/.test(text)) topic = '响应慢'
    else if (/质量|就坏/.test(text)) topic = '质量问题'
    if (topic && ctx.slots.complaintTopic?.value !== topic) {
      push('complaintTopic', ctx.slots.complaintTopic ? 'update' : 'set', topic, `已记录投诉主题：${topic}`)
    }
  }
  const om = text.match(/订单号?[是为:：]?\s*([A-Za-z]+[-_]?[0-9]{3,}|[0-9]{6,})/)
  if (om) {
    push('orderRef', ctx.slots.orderRef ? 'update' : 'set', om[1], `已记录订单号 ${om[1]}`)
  }
  const sg = text.match(/建议[^，。]{0,6}?(?:加|增加|添加|上线)(一?个?)([^，。]{2,20})/)
  if (sg) {
    const detail = sg[2].replace(/^[个]/, '')
    push('suggestion', ctx.slots.suggestion ? 'update' : 'set', detail, `已记录您的建议：${detail}`)
  }

  // ---- 安全确认（高危故障场景下用户确认已断电/关阀） ----
  const hasHighRiskHistory = (((ctx.slots.faultSymptoms?.value as string[] | undefined) ?? []) as string[]).some((f) =>
    ['漏电', '跳闸', '冒烟', '烧焦味'].includes(f)
  )
  if ((HIGH_RISK_FAULT.test(text) || hasHighRiskHistory) && /断电|关(闭)?燃气|关阀|拔(掉)?电源|已关闭/.test(text)) {
    if (!ctx.slots.safetyConfirmed) {
      push('safetyConfirmed', 'set', true, '已确认断电/关闭燃气阀门')
    }
  }

  // ---- 追问承接：仅自由文本类槽位承接上一轮追问，结构化槽位保持待问状态 ----
  const TEXT_PENDING: SlotKey[] = ['complaintResolution', 'faultDuration']
  if (ctx.pendingAsk && intent.primaryIntent === (ctx.currentIntent ?? intent.primaryIntent)) {
    const pk = ctx.pendingAsk.slot
    const directlyExtracted = updates.some((u) => u.key === pk)
    if (TEXT_PENDING.includes(pk) && !directlyExtracted) {
      push(pk, ctx.slots[pk] ? 'update' : 'set', sanitizeRaw(text).slice(0, 60), `已补充相关信息`)
    }
  }

  // 高危故障标记（供安全话术使用，通过故障词判断，不额外落槽位）
  if (HIGH_RISK_FAULT.test(text)) {
    push('__highRisk' as SlotKey, 'set', true, '检测到高危故障词')
  }

  return updates
}

interface DimEntryLike {
  location?: string
  width?: number
  depth?: number
  height?: number
  unit: string
  turn: number
}

export { sanitizeRaw }
export type { DimEntryLike }
