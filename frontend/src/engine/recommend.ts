// 可解释推荐引擎：硬约束过滤 + 加权评分（各品类权重和恒为100）+ 多品类组合
// 所有结论均可回溯到用户槽位与商品结构化字段；同输入产出稳定结果。
import type { Product } from '../types/data.ts'
import { familyPhrase, prefLabel, LOCAL_NEED_LABELS, PREF_LABELS } from './labels.ts'
import type { EmptyResult, RecBundle, RecCard, SubScore } from './types.ts'

export interface DimInput {
  location?: string
  width?: number
  depth?: number
  height?: number
  unit: string
}

export interface SlotsInput {
  categories: string[]
  totalBudget?: number
  totalBudgetRange?: { min?: number; max?: number }
  totalBudgetMin?: number
  budgetFloating?: boolean
  budgetStrict?: boolean
  cheapPreference?: boolean
  itemBudget?: number
  itemBudgetRange?: { min?: number; max?: number }
  itemBudgetByCategory?: Record<string, number>
  familySize?: number
  familySizeMin?: number
  houseArea?: number
  roomArea?: number
  installationDimensions?: DimInput[]
  location?: string
  preferences: string[]
  localNeeds: string[]
  purchaseTime?: string
}

export interface RecommendOptions {
  exclude?: Record<string, string[]>
}

export interface RecRefusal {
  code: 'no_category' | 'no_total_budget' | 'dims_pending'
  message: string
}

export interface RecommendOutcome {
  cards: Record<string, RecCard[]>
  bundles: RecBundle[]
  infeasible: { strategy: string; reason: string }[]
  nearest: { name: string; gaps: string[] } | null
  empty: EmptyResult | null
  refused: RecRefusal | null
  elapsedMs: number
}

type WeightMap = Record<string, number>

export interface BudgetReq {
  min?: number
  max?: number
  kind: 'range' | 'max' | 'min'
  strict: boolean
  floating: boolean
  source: string
}

// 品类感知的偏好目标维度（修复 large_capacity 在非冰箱品类静默失效的问题）
export function prefTargetDim(cat: string, pref: string): string | null {
  if (pref === 'energy_saving') return 'energy'
  if (pref === 'quiet') return 'noise'
  if (pref === 'cost_effective') return 'value'
  if (pref === 'smart' || pref === 'easy_operation') return 'feature'
  if (pref === 'large_capacity') {
    switch (cat) {
      case '洗碗机': return 'sets'
      case '热水器': return 'liter'
      case '电视': return 'inch'
      case '空调': return 'area'
      default: return 'capacity'
    }
  }
  return null
}

const UNIT_TO_MM: Record<string, number> = { mm: 1, 毫米: 1, cm: 10, 公分: 10, 厘米: 10, m: 1000, 米: 1000 }

const CATEGORY_LOCATIONS: Record<string, string[]> = {
  冰箱: ['厨房'],
  洗衣机: ['阳台'],
  洗碗机: ['厨房', '阳台'],
  空调: ['客厅', '卧室'],
  电视: ['客厅'],
  热水器: ['卫生间', '阳台', '厨房']
}

const DIM_LABEL: Record<string, string> = {
  budget: '预算匹配',
  capacity: '容量/人数匹配',
  freezer: '冷冻与海鲜储存',
  area: '面积/匹数匹配',
  inch: '屏幕尺寸匹配',
  sets: '套数/人数匹配',
  liter: '升数/人数匹配',
  safety: '安装与安全',
  size: '安装尺寸',
  energy: '能效',
  noise: '噪声',
  feature: '功能配置',
  resolution: '分辨率',
  rating: '用户口碑',
  value: '性价比'
}

const BASE_WEIGHTS: Record<string, WeightMap> = {
  冰箱: { budget: 25, capacity: 20, freezer: 15, size: 10, energy: 10, noise: 10, rating: 5, value: 5 },
  洗衣机: { budget: 25, capacity: 20, noise: 15, size: 10, energy: 10, feature: 10, rating: 5, value: 5 },
  空调: { budget: 25, area: 25, energy: 15, noise: 15, size: 5, feature: 5, rating: 5, value: 5 },
  热水器: { budget: 25, liter: 25, safety: 15, size: 10, energy: 10, noise: 5, rating: 5, value: 5 },
  电视: { budget: 25, inch: 25, feature: 15, resolution: 10, energy: 10, size: 5, rating: 5, value: 5 },
  洗碗机: { budget: 25, sets: 25, size: 15, noise: 15, energy: 10, rating: 5, value: 5 }
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)))

function prefBoostText(p: Product, s: SlotsInput): string {
  const prefs = s.preferences ?? []
  if (prefs.includes('quiet') && p.noiseDb?.standard !== undefined) {
    const t = noiseTarget(p.category)
    if (p.noiseDb.standard > t.ideal + 3) return `噪声 ${p.noiseDb.standard}dB 高于静音偏好（建议 ≤${t.ideal + 3}dB）`
  }
  if (prefs.includes('energy_saving') && p.energyGrade === '三级') return '能效等级为三级，与节能偏好有差距'
  return ''
}
const round1 = (v: number) => Math.round(v * 10) / 10

function energyScore(grade: string): number {
  if (grade === '新一级') return 100
  if (grade === '一级') return 85
  if (grade === '二级') return 65
  return 45
}

function noiseTarget(cat: string): { ideal: number; slope: number } {
  switch (cat) {
    case '冰箱': return { ideal: 38, slope: 4 }
    case '洗衣机': return { ideal: 48, slope: 6 }
    case '空调': return { ideal: 22, slope: 6 }
    case '洗碗机': return { ideal: 44, slope: 6 }
    case '热水器': return { ideal: 44, slope: 5 }
    default: return { ideal: 40, slope: 6 }
  }
}

function adjustWeights(cat: string, prefs: string[], strategy?: string, needs: string[] = [], cheap = false): WeightMap {
  const w: WeightMap = { ...BASE_WEIGHTS[cat] }
  const take = (amount: number): boolean => {
    if (w.rating >= amount) {
      w.rating -= amount
      return true
    }
    if ((w.value ?? 0) >= amount) {
      w.value -= amount
      return true
    }
    for (const k of ['size', 'feature', 'energy', 'noise', 'capacity', 'freezer', 'sets', 'liter', 'area', 'inch', 'safety', 'resolution']) {
      if ((w[k] ?? 0) >= amount) {
        w[k] -= amount
        return true
      }
    }
    return false
  }
  if (cat === '冰箱' && (needs ?? []).includes('seafood_freezing') && take2(w, 5, 'value')) {
    w.freezer += 5
  }
  for (const p of (prefs ?? []).slice(0, 2)) {
    const target = prefTargetDim(cat, p)
    if (target && target in w && take(5)) w[target] += 5
  }
  if (cheap && take2(w, 8, 'feature')) w.value += 8
  if (strategy === 'eco_quiet') {
    const bonus = 8
    if (take2(w, bonus, 'budget')) w.energy += bonus
    if ((w.noise ?? 0) > 0 && take2(w, bonus, 'value')) w.noise += bonus
  }
  if (strategy === 'value') {
    const bonus = 10
    if (take2(w, bonus, 'feature')) w.value += bonus
    if (take2(w, bonus, 'rating')) w.budget += bonus
  }
  // 归一化，保证权重和恒为100
  const sum = Object.values(w).reduce((a, b) => a + b, 0)
  if (sum !== 100) {
    const k = 100 / sum
    for (const key of Object.keys(w)) w[key] = Math.round(w[key] * k)
    const diff = 100 - Object.values(w).reduce((a, b) => a + b, 0)
    w.budget += diff
  }
  return w
}

function take2(w: WeightMap, amount: number, from: string): boolean {
  if ((w[from] ?? 0) >= amount) {
    w[from] -= amount
    return true
  }
  return false
}

function budgetReqFor(cat: string, s: SlotsInput): BudgetReq {
  const floating = Boolean(s.budgetFloating)
  const strict = Boolean(s.budgetStrict)
  if (s.itemBudgetByCategory?.[cat]) return { max: s.itemBudgetByCategory[cat], kind: 'max', strict, floating, source: `分品类预算（${cat}）` }
  if (s.itemBudgetRange) {
    const { min, max } = s.itemBudgetRange
    if (min && max) return { min, max, kind: 'range', strict, floating, source: '单品预算区间' }
    if (min) return { min, kind: 'min', strict, floating, source: '最低预算要求' }
    if (max) return { max, kind: 'max', strict, floating, source: '单品预算区间' }
  }
  if (s.itemBudget) return { max: s.itemBudget, kind: 'max', strict, floating, source: '单品预算' }
  if (s.categories.length === 1 && s.totalBudgetMin) return { min: s.totalBudgetMin, kind: 'min', strict, floating, source: '总预算下限' }
  if (s.categories.length === 1 && s.totalBudgetRange?.max) return { max: s.totalBudgetRange.max, kind: 'max', strict, floating, source: '总预算' }
  if (s.categories.length === 1 && s.totalBudget) return { max: s.totalBudget, kind: 'max', strict, floating, source: '总预算' }
  return { kind: 'max', strict, floating, source: '' }
}

function budgetFit(price: number, req: BudgetReq): { score: number; reason: string; ratio?: number; exceed?: number; belowMin?: number } {
  if (req.kind === 'min' && req.min !== undefined) {
    if (price >= req.min) return { score: 100, reason: `价格 ${price} 元，满足至少 ${req.min} 元的要求` }
    return { score: 40, reason: `价格 ${price} 元，低于你要求的至少 ${req.min} 元` }
  }
  if (req.kind === 'range' && req.min !== undefined && req.max !== undefined) {
    if (price >= req.min && price <= req.max) {
      return { score: 100, reason: `价格 ${price} 元，在你期望的 ${req.min}～${req.max} 元区间内`, ratio: Math.round((price / req.max) * 100) }
    }
    if (price < req.min) {
      const below = req.min - price
      return { score: 75, reason: `价格 ${price} 元，低于期望区间下限 ${req.min} 元（省 ${below} 元的节省预算选项）`, ratio: Math.round((price / req.min) * 100), belowMin: below }
    }
    const exceed = price - req.max
    if (req.floating && price <= Math.round(req.max * 1.1)) {
      return { score: 55, reason: `价格 ${price} 元，超出期望区间上限 ${req.max} 元（你说的是“左右”，需你确认）`, exceed }
    }
    return { score: 30, reason: `价格 ${price} 元，高于期望区间上限 ${req.max} 元`, exceed }
  }
  const max = req.max
  if (max !== undefined) {
    const ratio = Math.round((price / max) * 100)
    if (price <= max) {
      const score = ratio <= 80 ? 100 : ratio <= 90 ? 90 : 80
      return { score, reason: `价格 ${price} 元，在 ${max} 元预算内（占 ${ratio}%）`, ratio }
    }
    const exceed = price - max
    if (req.floating && price <= Math.round(max * 1.1)) {
      return { score: 55, reason: `价格 ${price} 元，超出预算 ${exceed} 元（你说的是“左右”，可少量浮动，需你确认）`, ratio, exceed }
    }
    return { score: 0, reason: `价格 ${price} 元，超出预算上限 ${max} 元`, ratio }
  }
  return { score: 70, reason: '仅提供组合总预算，单品按分配参考预算计入（组合参考预算，非单品明确预算）' }
}

function sizeInfo(p: Product, cat: string, s: SlotsInput): { status: '匹配' | '尺寸待确认' | '超限'; score: number; reason: string; fit: boolean } {
  const locs = CATEGORY_LOCATIONS[cat] ?? []
  const dim = (s.installationDimensions ?? []).find((d) => d.location && locs.includes(d.location))
  if (!dim || (dim.width === undefined && dim.depth === undefined)) {
    return { status: '尺寸待确认', score: 60, reason: '安装尺寸尚未提供，按中等匹配计入', fit: true }
  }
  const factor = UNIT_TO_MM[dim.unit] ?? 1
  const availW = dim.width !== undefined ? dim.width * factor : undefined
  const availD = dim.depth !== undefined ? dim.depth * factor : undefined
  const pw = p.dimensionsMm.width
  const pd = p.dimensionsMm.depth
  if (availW !== undefined && pw > availW) {
    return { status: '超限', score: 0, reason: `宽度 ${pw}mm 超出预留 ${availW}mm`, fit: false }
  }
  if (availD !== undefined && pd > availD) {
    return { status: '超限', score: 0, reason: `深度 ${pd}mm 超出预留 ${availD}mm`, fit: false }
  }
  const margin = Math.min(availW !== undefined ? (availW - pw) / availW : 1, availD !== undefined ? (availD - pd) / availD : 1)
  const score = margin >= 0.1 ? 100 : margin >= 0.02 ? 85 : 70
  const parts: string[] = []
  if (availW !== undefined) parts.push(`宽 ${pw}/${availW}mm`)
  if (availD !== undefined) parts.push(`深 ${pd}/${availD}mm`)
  return { status: '匹配', score, reason: `尺寸符合预留空间（${parts.join('，')}）`, fit: true }
}

function areaFit(p: Product, s: SlotsInput): { score: number; reason: string; hardFail: boolean } {
  if (p.category !== '空调' && p.category !== '电视') return { score: 100, reason: '', hardFail: false }
  const area = p.category === '空调' ? s.roomArea : s.roomArea ?? s.houseArea
  if (!area || !p.suitableArea) return { score: 60, reason: '面积未提供，适配情况待确认', hardFail: false }
  const [lo, hi] = p.suitableArea
  if (area >= lo && area <= hi) return { score: 100, reason: `适用面积 ${lo}-${hi}㎡ 覆盖你的 ${area}㎡`, hardFail: false }
  if (area >= lo - 3 && area <= hi + 3) return { score: 70, reason: `适用面积 ${lo}-${hi}㎡ 与你的 ${area}㎡ 略有偏差`, hardFail: false }
  return { score: 20, reason: `适用面积 ${lo}-${hi}㎡ 与你的 ${area}㎡ 明显不匹配`, hardFail: true }
}

function capacityDim(cat: string, p: Product, s: SlotsInput): SubScore {
  const fridge = p as import('../types/data.ts').FridgeProduct
  const washer = p as import('../types/data.ts').WasherProduct
  const heater = p as import('../types/data.ts').WaterHeaterProduct
  const dishwasher = p as import('../types/data.ts').DishwasherProduct
  const f = s.familySize ?? s.familySizeMin
  const isMinFamily = !s.familySize && Boolean(s.familySizeMin)
  const famText = f ? (isMinFamily ? `${f} 人及以上家庭` : familyPhrase(f)) : ''
  const prefBoost = (s.preferences ?? []).includes('large_capacity')
  const dimKey = cat === '洗碗机' ? 'sets' : cat === '热水器' ? 'liter' : 'capacity'
  const mk = (score: number, reason: string, fields: string[]): SubScore => ({
    key: dimKey, label: DIM_LABEL[dimKey] ?? DIM_LABEL.capacity, weight: 0, score, reason, fieldRefs: fields
  })
  switch (cat) {
    case '冰箱': {
      const v = fridge.capacityL
      if (!f) return mk(60, '家庭人数未提供，按中等匹配计入（待确认）', ['capacityL'])
      const low = f * 60 + 110
      const high = f * 90 + 150
      if (v >= low && v <= high) return mk(100, `${familyPhrase(f)}适用容积约 ${low}～${high}L，该冰箱总容积 ${v}L，正好处于区间`, ['capacityL'])
      if (v < low) return mk(clamp(100 - ((low - v) / low) * 300, 20), `${familyPhrase(f)}适用容积约 ${low}～${high}L，该冰箱总容积 ${v}L 偏小`, ['capacityL'])
      return mk(clamp(100 - ((v - high) / high) * 80, 45), `${familyPhrase(f)}适用容积约 ${low}～${high}L，该冰箱总容积 ${v}L 偏大${prefBoost ? '，符合你的大容量偏好' : ''}`, ['capacityL'])
    }
    case '洗衣机': {
      const v = washer.washCapacityKg
      if (!f) return mk(60, '家庭人数未提供，按中等匹配计入（待确认）', ['washCapacityKg'])
      const ideal = f * 2 + 4
      if (Math.abs(v - ideal) <= 2) return mk(100, `${famText}建议洗涤容量 ${ideal - 2}～${ideal + 2}kg，该洗衣机为 ${v}kg`, ['washCapacityKg'])
      return mk(clamp(100 - Math.abs(v - ideal) * 15, 35), `${famText}建议洗涤容量 ${ideal - 2}～${ideal + 2}kg，该洗衣机为 ${v}kg，${v > ideal ? '容量富余' : '容量偏小'}`, ['washCapacityKg'])
    }
    case '热水器': {
      const v = heater.literL
      if (!f) return mk(60, '家庭人数未提供，按中等匹配计入（待确认）', ['literL'])
      if (heater.heatType === '燃气式') return mk(85, `燃气式即热供水，${v}L 升位可满足${familyPhrase(f)}连续使用`, ['literL', 'heatType'])
      if (heater.heatType === '空气能') return mk(f >= 4 ? 95 : 75, `空气能 ${v}L 大水箱${f >= 4 ? `适合${familyPhrase(f)}多点多量用水` : '，对当前人数略有富余'}`, ['literL', 'heatType'])
      const ideal = f * 20 + 10
      if (Math.abs(v - ideal) <= 25) return mk(100, `${familyPhrase(f)}建议储水量约 ${ideal - 25}～${ideal + 25}L，该热水器为 ${v}L`, ['literL'])
      return mk(clamp(100 - Math.abs(v - ideal) * 2, 35), `${familyPhrase(f)}建议储水量约 ${ideal - 25}～${ideal + 25}L，该热水器为 ${v}L`, ['literL'])
    }
    case '洗碗机': {
      const v = dishwasher.placeSets
      if (!f) return mk(60, '家庭人数未提供，按中等匹配计入（待确认）', ['placeSets'])
      const ideal = f * 2.5 + 2
      if (Math.abs(v - ideal) <= 2) return mk(100, `${familyPhrase(f)}建议 ${Math.round(ideal - 2)}～${Math.round(ideal + 2)} 套，该洗碗机为 ${v} 套`, ['placeSets'])
      return mk(clamp(100 - Math.abs(v - ideal) * 15, 35), `${familyPhrase(f)}建议 ${Math.round(ideal - 3)}～${Math.round(ideal + 3)} 套，该洗碗机为 ${v} 套`, ['placeSets'])
    }
    default:
      return mk(70, '品类无专属容量维度，按基准计入', [])
  }
}

function specialDims(cat: string, p: Product, s: SlotsInput, weights: WeightMap): SubScore[] {
  const out: SubScore[] = []
  const fridge = p as import('../types/data.ts').FridgeProduct
  const heater = p as import('../types/data.ts').WaterHeaterProduct
  const tv = p as import('../types/data.ts').TvProduct
  if (cat === '冰箱') {
    const need = (s.localNeeds ?? []).includes('seafood_freezing')
    const fz = fridge.freezerCapacityL
    const score = need
      ? clamp((fz / 150) * 70 + (fridge.deepFreeze ? 30 : 15))
      : clamp(50 + (fz / 200) * 40 + (fridge.deepFreeze ? 10 : 0))
    out.push({
      key: 'freezer', label: DIM_LABEL.freezer, weight: 0, score,
      reason: need
        ? `你有海鲜冷冻需求：该冰箱冷冻室 ${fz}L${fridge.deepFreeze ? '，支持深冷速冻，可缩短冻结时间' : '，未标注深冷速冻'}`
        : `冷冻室 ${fz}L${fridge.deepFreeze ? '，支持深冷速冻' : ''}`,
      fieldRefs: ['freezerCapacityL', 'deepFreeze']
    })
  }
  if (cat === '空调') {
    const area = areaFit(p, s)
    out.push({
      key: 'area', label: DIM_LABEL.area, weight: 0, score: area.score,
      reason: area.reason || `匹数 ${(p as import('../types/data.ts').AcProduct).horsepower} 匹`, fieldRefs: ['suitableArea', 'horsepower'], ...(area.hardFail ? { hardFail: true } : {})
    } as SubScore)
  }
  if (cat === '电视') {
    const area = s.roomArea ?? s.houseArea
    let score = 60
    let reason = '观看面积未提供，屏幕尺寸适配待确认'
    if (area && tv.inchSize) {
      const bands: [number, number, number, number][] = [
        [0, 15, 40, 50], [16, 25, 50, 65], [26, 40, 65, 85], [41, 99, 75, 98]
      ]
      const band = bands.find(([lo, hi]) => area >= lo && area <= hi)
      if (band && tv.inchSize >= band[2] && tv.inchSize <= band[3]) {
        score = 100
        reason = `观看面积约 ${area}㎡，建议 ${band[2]}-${band[3]} 英寸，该电视为 ${tv.inchSize} 英寸`
      } else if (band) {
        score = 55
        reason = `观看面积约 ${area}㎡，建议 ${band[2]}-${band[3]} 英寸，该电视为 ${tv.inchSize} 英寸，尺寸${tv.inchSize < band[2] ? '偏小' : '偏大'}`
      }
    }
    out.push({ key: 'inch', label: DIM_LABEL.inch, weight: 0, score, reason, fieldRefs: ['inchSize'] })
    out.push({
      key: 'resolution', label: DIM_LABEL.resolution, weight: 0,
      score: tv.resolution === '8K超高清' ? 100 : tv.resolution === '4K超高清' ? 90 : 65,
      reason: `分辨率为${tv.resolution}`, fieldRefs: ['resolution']
    })
  }
  if (cat === '热水器') {
    const score = heater.heatType === '燃气式' ? 70 : heater.heatType === '空气能' ? 85 : 90
    const note = heater.heatType === '燃气式' ? '燃气式需专业持证安装并保证通风' : heater.heatType === '空气能' ? '空气能对安装空间有一定要求' : '电热式安装要求较低，常规电路即可'
    out.push({ key: 'safety', label: DIM_LABEL.safety, weight: 0, score, reason: `${heater.heatType}：${note}`, fieldRefs: ['heatType'] })
  }
  void weights
  return out
}

function commonDims(cat: string, p: Product, s: SlotsInput, weights: WeightMap): SubScore[] {
  const out: SubScore[] = []
  const nT = noiseTarget(cat)
  const noise = p.noiseDb?.standard
  if (weights.noise > 0 && noise !== undefined) {
    out.push({
      key: 'noise', label: DIM_LABEL.noise, weight: 0,
      score: clamp(100 - Math.max(0, noise - nT.ideal) * nT.slope),
      reason: `标准运行噪声 ${noise}dB${(s.preferences ?? []).includes('quiet') ? `（你重视静音，该值${noise <= nT.ideal + 3 ? '表现优秀' : '一般'}）` : ''}`,
      fieldRefs: ['noiseDb.standard']
    })
  }
  if (weights.energy > 0) {
    out.push({
      key: 'energy', label: DIM_LABEL.energy, weight: 0, score: energyScore(p.energyGrade),
      reason: `能效等级为${p.energyGrade}${(s.preferences ?? []).includes('energy_saving') ? '（你重视节能）' : ''}`,
      fieldRefs: ['energyGrade']
    })
  }
  if (weights.feature > 0) {
    const hot = ['变频', '静音', '除菌', '自清洁', '烘干', '新风', '风冷无霜', '深冷速冻', '量子点', 'MiniLED', '洗烘']
    const hits = p.tags.filter((t) => hot.some((h) => t.includes(h) || h.includes(t)))
    out.push({
      key: 'feature', label: DIM_LABEL.feature, weight: 0,
      score: clamp(60 + hits.length * 20),
      reason: hits.length > 0 ? `功能配置：${hits.join('、')}` : '基础功能配置',
      fieldRefs: ['tags']
    })
  }
  out.push({
    key: 'rating', label: DIM_LABEL.rating, weight: 0, score: Math.round((p.rating / 5) * 100),
    reason: `模拟口碑评分 ${p.rating} 分（满分5分）`, fieldRefs: ['rating']
  })
  return out
}

function buildCard(
  p: Product, s: SlotsInput, weights: WeightMap, req: BudgetReq,
  setRange: { min: number; max: number }
): RecCard {
  const subs: SubScore[] = []

  const bf = budgetFit(p.price, req)
  subs.push({
    key: 'budget', label: DIM_LABEL.budget, weight: 0, score: bf.score,
    reason: bf.reason, fieldRefs: ['price']
  })

  const cap = capacityDim(p.category, p, s)
  if ((weights.capacity ?? weights.sets ?? weights.liter ?? 0) > 0) subs.push(cap)

  for (const sp of specialDims(p.category, p, s, weights)) {
    const key = sp.key
    if (weights[key] !== undefined && weights[key] > 0) subs.push(sp)
  }
  subs.push(...commonDims(p.category, p, s, weights))

  if (weights.value > 0) {
    const span = setRange.max - setRange.min
    const valueScore = span <= 0 ? 70 : clamp(100 - ((p.price - setRange.min) / span) * 50)
    subs.push({
      key: 'value', label: DIM_LABEL.value, weight: 0, score: valueScore,
      reason: `在同候选价位段中价格处于 ${Math.round(((p.price - setRange.min) / span) * 100)}% 分位（越低越划算）`,
      fieldRefs: ['price']
    })
  }

  const size = sizeInfo(p, p.category, s)
  subs.push({ key: 'size', label: DIM_LABEL.size, weight: 0, score: size.score, reason: size.reason, fieldRefs: ['dimensionsMm.width', 'dimensionsMm.depth'] })

  // 硬失败（面积/尺寸）直接归零
  const hardFail = subs.some((x) => (x as SubScore & { hardFail?: boolean }).hardFail) || !size.fit

  let total = 0
  const finalSubs: SubScore[] = []
  for (const sub of subs) {
    const w = weights[sub.key] ?? 0
    if (w <= 0) continue
    const scored = hardFail && (sub.key === 'size' || (sub as SubScore & { hardFail?: boolean }).hardFail) ? Math.min(sub.score, 20) : sub.score
    finalSubs.push({ ...sub, weight: w, score: scored })
    total += (w * scored) / 100
  }
  const totalScore = Math.round(total * 10) / 10

  const sorted = [...finalSubs].sort((a, b) => (b.weight * b.score) / 100 - (a.weight * a.score) / 100)
  const reasons = sorted.filter((x) => x.score >= 60 && x.reason).slice(0, 3).map((x) => x.reason)
  const caveats: string[] = []
  if (bf.exceed) caveats.push(`超出预算 ${bf.exceed} 元，需要你确认`)
  if (bf.belowMin) caveats.push(`低于期望区间 ${bf.belowMin} 元（节省预算选项，非完全命中）`)
  if (size.status === '尺寸待确认') {
    const providedW = (s.installationDimensions ?? []).some((d) => d.width)
    caveats.push(providedW ? '已按已提供宽度初步校验；深度尚未提供，安装前需确认' : '安装尺寸待确认：尚未提供宽深数值，安装前需确认')
  }
  if ((s.preferences ?? []).includes('quiet')) {
    const nSub = finalSubs.find((x) => x.key === 'noise')
    if (nSub && nSub.score < 70) caveats.push(`噪声 ${p.noiseDb?.standard}dB 与你的静音偏好有差距`)
  }
  if (p.stockStatus === '库存紧张') caveats.push('库存紧张，建议尽快确认')
  if (p.stockStatus === '预售') caveats.push('预售商品，送达时间以页面为准')
  if (p.limitations?.length) caveats.push(p.limitations[0])

  const prefsArr = s.preferences ?? []
  const needsArr = s.localNeeds ?? []
  const usedSlots: string[] = ['categories']
  if (req.max || req.min) usedSlots.push(req.source.includes('总预算') ? 'totalBudget' : 'itemBudget')
  if (s.familySize) usedSlots.push('familySize')
  if (s.roomArea) usedSlots.push('roomArea')
  if ((s.installationDimensions ?? []).length > 0) usedSlots.push('installationDimensions')
  if (prefsArr.length > 0) usedSlots.push('preferences')
  if (needsArr.length > 0) usedSlots.push('localNeeds')

  const usedFields = Array.from(new Set(finalSubs.flatMap((x) => x.fieldRefs)))

  return {
    productId: p.id,
    category: p.category,
    name: p.name,
    brand: p.brand,
    price: p.price,
    totalScore,
    subScores: finalSubs.sort((a, b) => b.weight - a.weight),
    reasons: reasons.length >= 2 ? reasons.slice(0, 3) : [...reasons, ...finalSubs.filter((x) => x.reason).slice(0, 2 - reasons.length).map((x) => x.reason)].slice(0, 2),
    caveats,
    usedFields,
    usedSlots: Array.from(new Set(usedSlots)),
    budgetCeiling: req.max,
    budgetRatio: bf.ratio,
    budgetExceed: bf.exceed,
    sizeFitStatus: hardFail ? '超限' : size.status,
    stockStatus: p.stockStatus
  }
}

function hardFilter(p: Product, cat: string, s: SlotsInput, req: BudgetReq): { pass: boolean; reason?: string } {
  if (p.category !== cat) return { pass: false, reason: '品类不符' }
  if (String(p.stockStatus) === '无货') return { pass: false, reason: '无库存' }
  if (req.max !== undefined && !req.floating && p.price > req.max) return { pass: false, reason: `超出预算上限 ${req.max} 元` }
  if (req.max !== undefined && req.floating && p.price > Math.round(req.max * 1.1)) return { pass: false, reason: `超出预算上浮空间（${req.max} 元左右）` }
  if (req.kind === 'min' && req.min !== undefined && p.price < req.min) return { pass: false, reason: `低于你要求的至少 ${req.min} 元` }
  if (p.category === '空调' || p.category === '电视') {
    const area = areaFit(p, s)
    if (area.hardFail) return { pass: false, reason: '适用面积明显不匹配' }
  }
  const size = sizeInfo(p, cat, s)
  if (!size.fit) return { pass: false, reason: size.reason }
  return { pass: true }
}

// 稳定排序：总分（1位小数）→ 关键偏好命中数 → 预算贴合 → 库存 → 商品ID，同输入结果恒定
const STOCK_ORDER: Record<string, number> = { 有货: 3, 库存紧张: 2, 预售: 1 }

export function compareCards(a: RecCard, b: RecCard, s: SlotsInput): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore
  const hits = (c: RecCard): number =>
    (s.preferences ?? []).filter((p) => {
      const dim = prefTargetDim(c.category, p)
      const sub = dim ? c.subScores.find((x) => x.key === dim) : null
      return sub ? sub.score >= 70 : false
    }).length
  const ha = hits(a)
  const hb = hits(b)
  if (hb !== ha) return hb - ha
  const ba = a.subScores.find((x) => x.key === 'budget')?.score ?? 0
  const bb = b.subScores.find((x) => x.key === 'budget')?.score ?? 0
  if (bb !== ba) return bb - ba
  const sa = STOCK_ORDER[a.stockStatus] ?? 0
  const sb = STOCK_ORDER[b.stockStatus] ?? 0
  if (sb !== sa) return sb - sa
  return a.productId < b.productId ? -1 : 1
}

export function recommendFromSlots(s: SlotsInput, catalog: Product[], opts: RecommendOptions = {}): RecommendOutcome {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const outcome: RecommendOutcome = { cards: {}, bundles: [], infeasible: [], nearest: null, empty: null, refused: null, elapsedMs: 0 }

  if (!s.categories || s.categories.length === 0) {
    outcome.refused = { code: 'no_category', message: '请先告诉我你想了解的品类（冰箱、洗衣机、空调、热水器、电视、洗碗机），我再为你推荐。' }
    outcome.elapsedMs = round1((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
    return outcome
  }
  if (s.categories.length >= 2 && !s.totalBudget) {
    outcome.refused = { code: 'no_total_budget', message: '多个品类一起买时，请先告诉我总预算，我会据此在品类间做合理分配。' }
    outcome.elapsedMs = round1((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
    return outcome
  }
  if (s.categories.length >= 2 && !(s.installationDimensions ?? []).some((d) => d.width !== undefined || d.depth !== undefined)) {
    outcome.refused = { code: 'dims_pending', message: '为了确保尺寸合适，请先告诉我预留的安装宽度和深度（公分或毫米都可以），我再为你生成组合方案。' }
    outcome.elapsedMs = round1((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
    return outcome
  }

  const cards: Record<string, RecCard[]> = {}
  const catData: Record<string, { ranked: { p: Product; card: RecCard }[]; req: BudgetReq }> = {}

  for (const cat of s.categories) {
    const baseWeights = adjustWeights(cat, s.preferences, undefined, s.localNeeds, s.cheapPreference)
    const req = budgetReqFor(cat, s)
    let pool = catalog.filter((p) => hardFilter(p, cat, s, req).pass)
    const excluded = opts.exclude?.[cat] ?? []
    if (excluded.length > 0 && pool.length > excluded.length) {
      pool = pool.filter((p) => !excluded.includes(p.id))
    }
    // ===== 多品类总预算硬约束：单品必须能与其它品类最低价商品组成 ≤ 总预算上限的可行组合 =====
    if (s.categories.length >= 2 && s.totalBudget) {
      const others = s.categories.filter((c) => c !== cat)
      const otherMin = others.length
        ? Math.min(...others.map((c) => Math.min(...catalog.filter((p) => p.category === c).map((p) => p.price))))
        : 0
      const before = pool.length
      pool = pool.filter((p) => p.price + otherMin <= s.totalBudget!)
      if (before > 0 && pool.length === 0) {
        const cheapest = Math.min(...catalog.filter((p) => p.category === cat).map((p) => p.price))
        outcome.infeasible.push({
          strategy: '总预算硬约束',
          reason: `${cat}最低约 ${cheapest} 元，与其它品类最低合计约 ${cheapest + otherMin} 元，超出总预算 ${s.totalBudget} 元（差距约 ${cheapest + otherMin - s.totalBudget} 元）；建议上调总预算至不低于 ${cheapest + otherMin} 元，或减少品类`
        })
      }
    }
    const prices2 = pool.map((p) => p.price)
    const setRange = { min: Math.min(...(prices2.length ? prices2 : [0])), max: Math.max(...(prices2.length ? prices2 : [1])) }
    const ranked = pool
      .map((p) => {
        const card = buildCard(p, s, baseWeights, req, setRange)
        if (s.categories.length >= 2 && s.totalBudget) {
          const share = Math.round(s.totalBudget / s.categories.length)
          if (p.price > share) {
            const budget4Pair = s.totalBudget - p.price
            const partnerPrice = Math.min(
              ...s.categories.filter((c) => c !== cat).flatMap((oc) => catalog.filter((q) => q.category === oc && q.price <= budget4Pair).map((q) => q.price)),
              Number.POSITIVE_INFINITY
            )
            if (Number.isFinite(partnerPrice)) {
              card.caveats = [`超出${cat}参考预算约 ${p.price - share} 元；搭配最低合规${s.categories.filter((c) => c !== cat).join('/')}（约 ${partnerPrice} 元）后组合约 ${p.price + partnerPrice} 元，仍在总预算内`, ...card.caveats]
            }
          }
        }
        return { p, card }
      })
      .sort((a, b) => compareCards(a.card, b.card, s))
    // 主推 3 款：评分前 2 款 + 预算内最低价基础款（保证至少一款能与其它品类组成本预算内组合）
    const top = ranked.slice(0, 2)
    const cheapestItem = ranked.reduce((a, b) => (b.p.price < a.p.price ? b : a), ranked[0])
    const main = ranked.filter((x) => x === cheapestItem || top.includes(x)).slice(0, 3)
    if (main.length < 3) {
      for (const x of ranked) {
        if (main.length >= 3) break
        if (!main.includes(x)) main.push(x)
      }
    }
    catData[cat] = { ranked: main, req }
    cards[cat] = main.map((x) => x.card)
  }
  outcome.cards = cards

  if (s.categories.length >= 2 && s.totalBudget) {
    buildBundles(s, catData, outcome)
  }

  // ===== 需求满足判定：区分“硬约束无候选”与“用户陈述的容量需求无法满足” =====
  const effSize = s.familySize ?? s.familySizeMin
  const capacityRelevant = Boolean(s.familySizeMin) || (s.preferences ?? []).includes('large_capacity')
  const cat0 = s.categories[0]
  const capOf = (p: Product): number | null => {
    if (cat0 === '冰箱') return (p as import('../types/data.ts').FridgeProduct).capacityL
    if (cat0 === '洗碗机') return (p as import('../types/data.ts').DishwasherProduct).placeSets
    if (cat0 === '热水器') return (p as import('../types/data.ts').WaterHeaterProduct).literL
    if (cat0 === '洗衣机') return (p as import('../types/data.ts').WasherProduct).washCapacityKg
    return null
  }
  const wantLargeWash = (s.preferences ?? []).includes('large_capacity')
  const capUnit0 = cat0 === '洗碗机' ? '套' : cat0 === '洗衣机' ? 'kg' : 'L'
  const capLow = cat0 === '洗衣机'
    ? (wantLargeWash ? 10.5 : effSize ? Math.round(effSize * 1.8) : null)
    : effSize ? (cat0 === '洗碗机' ? Math.round(effSize * 2.5) : cat0 === '热水器' ? effSize * 20 - 10 : effSize * 60 + 110) : null
  const capHigh = cat0 === '洗衣机'
    ? (wantLargeWash ? 16 : effSize ? Math.round(effSize * 1.8) + 3 : null)
    : effSize ? (cat0 === '洗碗机' ? Math.round(effSize * 2.5 + 3) : cat0 === '热水器' ? effSize * 20 + 40 : effSize * 90 + 150) : null
  let capacityRequirementMet = true
  let capacityUnmetCards: RecCard[] = []
  if (capacityRelevant && effSize && capLow !== null && s.categories.length > 0) {
    const flat = Object.values(cards).flat()
    const withCap = flat
      .map((c) => ({ c, cap: capOf(catalog.find((p) => p.id === c.productId) as Product) }))
      .filter((x) => x.cap !== null)
    capacityRequirementMet = withCap.some((x) => (x.cap as number) >= capLow)
    if (!capacityRequirementMet) {
      capacityUnmetCards = flat
      cards[cat0] = []
      for (const c of flat) {
        const cap = capOf(catalog.find((p) => p.id === c.productId) as Product)
        if (cap !== null && cap < capLow) {
          c.caveats = [`容量 ${cap}${capUnit0}，低于${s.familySize ? familyPhrase(effSize) : `${effSize} 人及以上家庭`}建议下限 ${capLow}${capUnit0}（差距 ${capLow - cap}${capUnit0}）`, ...c.caveats]
        }
      }
    }
  }

  // ===== 无完全匹配：明确的结果状态（过滤报告 + 冲突洞察 + 替代方案） =====
  const totalCards = Object.values(cards).flat().length
  if ((totalCards === 0 || !capacityRequirementMet) && s.categories.length >= 2 && s.totalBudget && outcome.infeasible.some((x) => x.strategy === '总预算硬约束')) {
    const perCatMin = s.categories.map((cat) => {
      const minP = Math.min(...catalog.filter((p) => p.category === cat).map((p) => p.price))
      return `${cat}最低约 ${minP} 元`
    })
    const comboMin = s.categories.reduce((acc, cat) => acc + Math.min(...catalog.filter((p) => p.category === cat).map((p) => p.price)), 0)
    const gap = comboMin - s.totalBudget!
    outcome.empty = {
      ...(outcome.empty ?? { filterReport: { totalProductsConsidered: catalog.length, categoryMatched: 0, afterStockFilter: 0, afterBudgetFilter: 0, afterAreaFilter: 0, afterCapacityFilter: 0, afterDimensionFilter: 0, exactMatchCount: 0, primaryConflict: '总预算不足' }, alternatives: [] }),
      kind: 'multi_category' as const,
      message: `当前总预算为 ${s.totalBudget} 元。满足现有硬性条件的${perCatMin.join('，')}，完整组合最低约 ${comboMin} 元，超出预算约 ${gap} 元。建议将总预算调整至不低于 ${comboMin} 元，或先购买其中一个品类。`,
      categoriesText: s.categories.join('、'),
      insight: null
    } as never
    outcome.elapsedMs = 0
    return outcome
  }
  if ((totalCards === 0 || !capacityRequirementMet) && s.categories.length > 0) {
    const cat = s.categories[0]
    const req = budgetReqFor(cat, s)
    const capUnit = capUnit0
    const c1 = catalog.filter((p) => p.category === cat)
    const c2 = c1.filter((p) => String(p.stockStatus) !== '无货')
    const c3 = c2.filter((p) => {
      if (req.max === undefined) return true
      const lim = req.floating ? Math.round(req.max * 1.1) : req.max
      return p.price <= lim
    })
    const c4 = c3.filter((p) => !areaFit(p, s).hardFail)
    const c5 = c4.filter((p) => sizeInfo(p, cat, s).fit)
    const c5cap = capacityRelevant && capLow !== null
      ? c5.filter((p) => { const v = capOf(p); return v !== null && v >= capLow })
      : c5
    const report = {
      totalProductsConsidered: catalog.length,
      categoryMatched: c1.length,
      afterStockFilter: c2.length,
      afterBudgetFilter: c3.length,
      afterAreaFilter: c4.length,
      afterCapacityFilter: capacityRelevant ? c5cap.length : c3.length,
      afterDimensionFilter: c5.length,
      exactMatchCount: capacityRelevant ? c5cap.length : c5.length,
      primaryConflict: ''
    }
    const drops: [string, number][] = (([
      ['库存', c1.length - c2.length],
      ['预算', c2.length - c3.length],
      ['面积', c3.length - c4.length],
      ['安装尺寸', c4.length - c5.length],
      ...(capacityRelevant && capLow !== null ? [['容量', c5.length - c5cap.length]] : [])
    ]) as [string, number][]).sort((a, b) => b[1] - a[1])
    report.primaryConflict = drops[0][1] > 0
      ? `${drops[0][0]}条件过滤了 ${drops[0][1]} 款商品`
      : '候选数量本身有限'

    const eff = s.familySize ?? s.familySizeMin
    const famText = eff ? (s.familySize ? familyPhrase(eff) : `${eff} 人及以上家庭`) : ''
    const low = eff ? (cat === '洗碗机' ? Math.round(eff * 2.5) : cat === '热水器' ? eff * 20 - 10 : eff * 60 + 110) : null
    const high = eff ? (cat === '洗碗机' ? Math.round(eff * 2.5 + 3) : cat === '热水器' ? eff * 20 + 40 : eff * 90 + 150) : null
    const capVals = c3.map((p) => capOf(p)).filter((v): v is number => v !== null)
    const maxCapInBudget = capVals.length > 0 ? Math.max(...capVals) : null
    const meetCandidates = c2.filter((p) => (low !== null && capOf(p) !== null && (capOf(p) as number) >= low))
    const minPriceForSuggested = meetCandidates.length > 0 ? Math.min(...meetCandidates.map((p) => p.price)) : null
    const capacityNote = low !== null && maxCapInBudget !== null
      ? `${famText || '当前需求'}建议容量约 ${capLow}～${capHigh}${capUnit}；预算内最大容量为 ${maxCapInBudget}${capUnit}，大容量为偏好条件（软性），预算维度才是主要过滤原因`
      : '该品类的关键适配维度为面积或尺寸，无容量概念'
    const conflictText = req.max !== undefined ? `${req.max} 元以内` : ''
    const famCond = eff ? `${famText}` : ''
    const prefCond = (s.preferences ?? []).map((p) => prefLabel(p)).join('、')
    const message = `暂未找到同时满足“${[conflictText, famCond, prefCond].filter(Boolean).join('、')}”的${cat}。`

    // 替代方案：容量需求未满足时使用已评分候选；硬过滤为空时用预算内候选
    const altPool = !capacityRequirementMet ? [] : c3.slice()
    const altRanked = altPool
      .map((p) => ({ p, card: buildCard(p, s, adjustWeights(cat, s.preferences, undefined, s.localNeeds, s.cheapPreference), req, { min: 0, max: 0 }) }))
      .sort((a, b) => compareCards(a.card, b.card, s))
      .slice(0, 3)
    const alternatives: RecCard[] = capacityRequirementMet
      ? altRanked.map((x) => {
          const cap = capOf(x.p)
          const gaps: string[] = []
          if (low !== null && cap !== null && cap < low) gaps.push(`容量 ${cap}${capUnit}，低于${famText || '当前需求'}建议下限 ${low}${capUnit}（差距 ${low - cap}${capUnit}）`)
          if (prefBoostText(x.p, s)) gaps.push(prefBoostText(x.p, s) as string)
          return { ...x.card, caveats: [`未满足原条件：${gaps.length > 0 ? gaps.join('；') : '部分偏好未完全命中'}`, ...x.card.caveats] }
        })
      : capacityUnmetCards.map((c) => ({ ...c, caveats: [`未满足原条件：${(c.caveats[0] ?? '').includes('容量') ? c.caveats[0] : '大容量需求在当前预算内无法满足'}`, ...c.caveats.slice(1)] }))

    outcome.empty = {
      message,
      categoriesText: s.categories.join('、'),
      filterReport: report,
      capacityNote,
      insight: {
        maxCapacityInBudget: maxCapInBudget,
        suggestedRangeLow: low,
        suggestedRangeHigh: high,
        minPriceForSuggested
      },
      capacityUnit: capUnit0,
      alternatives: capacityRequirementMet ? alternatives : [...alternatives].sort((a, b) => {
        const pa = catalog.find((p) => p.id === a.productId)
        const pb = catalog.find((p) => p.id === b.productId)
        const ca = pa ? (capOf(pa) ?? 0) : 0
        const cb = pb ? (capOf(pb) ?? 0) : 0
        if (cb !== ca) return cb - ca
        return a.price - b.price
      }),
      relaxationOptions: [
        ...(minPriceForSuggested !== null ? [{ label: `预算调整到约 ${minPriceForSuggested} 元`, action: 'budget_min' as const }] : []),
        { label: `查看${conflictText || '当前预算'}最接近商品`, action: 'show_nearest' as const },
        { label: '重新修改需求', action: 'modify' as const }
      ]
    }
  }

  // 无完全匹配时的最接近方案（仅提示差距，不冒充完全匹配）
  const empties = s.categories.filter((c) => (cards[c] ?? []).length === 0)
  if (empties.length > 0) {
    const cat = empties[0]
    const pool = catalog.filter((p) => p.category === cat)
    const req0 = budgetReqFor(cat, s)
    const near = pool.slice().sort((a, b) => {
      const da = req0.max ? Math.abs(a.price - req0.max) : a.price
      const db = req0.max ? Math.abs(b.price - req0.max) : b.price
      return da - db
    })[0]
    if (near) {
      const gaps: string[] = []
      if (req0.max && near.price > req0.max) gaps.push(`价格 ${near.price} 元高于预算 ${req0.max} 元`)
      const size = sizeInfo(near, cat, s)
      if (!size.fit) gaps.push(size.reason)
      const area = areaFit(near, s)
      if (area.hardFail) gaps.push(area.reason)
      outcome.nearest = { name: `${near.brand} ${near.name}（${near.id}）`, gaps: gaps.length > 0 ? gaps : ['与你的条件最接近的款式'] }
    }
  }

  outcome.elapsedMs = round1((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
  return outcome
}

const STRATEGIES: { key: string; name: string; flavor: string }[] = [
  { key: 'balanced', name: '均衡方案', flavor: '在预算、容量与体验之间取平衡' },
  { key: 'eco_quiet', name: '节能静音优先方案', flavor: '侧重能效等级与低噪声运行' },
  { key: 'value', name: '性价比优先方案', flavor: '在满足需求前提下控制花费' }
]

function buildBundles(s: SlotsInput, catData: Record<string, { ranked: { p: Product; card: RecCard }[]; req: BudgetReq }>, outcome: RecommendOutcome): void {
  const cats = s.categories
  const prefsList = s.preferences ?? []
  const needsList = s.localNeeds ?? []
  // ===== 枚举全部可行组合 → 按策略选择 → 最终去重 =====
  const allCombos: { items: { cat: string; p: Product; card: RecCard }[]; total: number; key: string }[] = []
  {
    let combos: { items: { cat: string; p: Product; card: RecCard }[]; total: number }[] = [{ items: [], total: 0 }]
    for (let ci = 0; ci < cats.length; ci++) {
      const cat = cats[ci]
      const mainPool = (catData[cat]?.ranked ?? []).slice(0, 3)
      const next: typeof combos = []
      for (const combo of combos) {
        for (const item of mainPool) {
          const total = combo.total + item.p.price
          if (total <= s.totalBudget!) {
            next.push({ items: [...combo.items, { cat, p: item.p, card: item.card }], total })
          }
        }
      }
      combos = next
    }
    const seen = new Set<string>()
    for (const c of combos) {
      const key = c.items.map((x) => `${x.cat}:${x.p.id}`).sort().join('|')
      if (!seen.has(key)) { seen.add(key); allCombos.push({ ...c, key }) }
    }
  }
  if (allCombos.length === 0) {
    outcome.infeasible.push({ strategy: '总预算硬约束', reason: `当前总预算 ${s.totalBudget} 元下暂无完整匹配组合；建议上调预算或减少品类。` })
    return
  }

  const usedKeys = new Set<string>()
  for (const st of STRATEGIES) {
    // 按策略排序：均衡→综合分降序；性价比→总价升序；节能静音→能效+噪声
    const sorted = [...allCombos].filter((c) => !usedKeys.has(c.key))
    if (sorted.length === 0) break
    if (st.key === 'value') {
      sorted.sort((a, b) => a.total - b.total)
    } else if (st.key === 'eco_quiet') {
      const ecoScore = (c: typeof sorted[0]) => c.items.reduce((acc, x) => {
        const eg = String(((x.p as unknown as Record<string, unknown>)).energyGrade ?? '')
        const er = eg.includes('一级') ? 3 : eg.includes('二级') ? 2 : 1
        const nd = ((x.p as unknown as Record<string, unknown>)).noiseDb
        const nz = typeof nd === 'object' && nd ? -(nd as { standard: number }).standard : typeof nd === 'number' ? -nd : -50
        return acc + er * 10 + nz
      }, 0)
      sorted.sort((a, b) => ecoScore(b) - ecoScore(a))
    } else {
      sorted.sort((a, b) => {
        const avg = (c: typeof sorted[0]) => c.items.reduce((acc, x) => acc + (x.card.totalScore ?? 0), 0) / c.items.length
        return avg(b) - avg(a)
      })
    }
    const best = sorted[0]
    usedKeys.add(best.key)
    const composite = Math.round(best.items.reduce((acc, x) => acc + (x.card.totalScore ?? 0), 0) / best.items.length)
    const advantages = [st.flavor, ...best.items.map((x) => `${x.cat}：${x.card.reasons[0] ?? '满足你的核心条件'}`)]
    const tradeoffs = best.items.map((x) => (x.card.caveats.length > 0 ? `${x.cat}：${x.card.caveats[0]}` : '')).filter(Boolean)
    const pendingInfo: string[] = []
    if (!(s.installationDimensions ?? []).some((d) => d.width !== undefined || d.depth !== undefined)) {
      pendingInfo.push('安装尺寸尚未提供，尺寸适配待确认')
    }
    const exceed = best.total - s.totalBudget!
    if (exceed > 0) pendingInfo.push(`总价超出总预算 ${exceed} 元（你说的是"左右"，需你确认）`)
    const prefsText = [...prefsList.map((p) => PREF_LABELS[p as keyof typeof PREF_LABELS] ?? p), ...needsList.map((n) => LOCAL_NEED_LABELS[n as keyof typeof LOCAL_NEED_LABELS] ?? n)].join('、')
    const portrait = `适合${s.familySize ? familyPhrase(s.familySize) : '你的家庭'}${prefsText ? `，重视${prefsText}` : ''}${s.location ? `，所在${s.location}` : ''}`
    outcome.bundles.push({
      strategy: st.key,
      name: st.name,
      items: best.items.map((x) => x.card),
      totalPrice: best.total,
      budgetDiff: exceed,
      compositeScore: composite,
      allocationText: `已从主推荐候选中生成预算内组合`,
      advantages: advantages.slice(0, 4),
      tradeoffs: tradeoffs.slice(0, 3),
      sizeReminder: (s.installationDimensions ?? []).some((d) => d.width && !d.depth)
        ? '已按已提供的宽度进行初步校验；深度尚未提供，安装前需确认。'
        : (s.installationDimensions ?? []).length > 0
          ? '已按你提供的预留空间校验尺寸'
          : '安装尺寸待确认，建议提供宽深后二次核对',
      pendingInfo,
      portrait
    })
  }
  if (outcome.bundles.length < STRATEGIES.length) {
    outcome.bundles.unshift({ strategy: 'note', name: `当前条件下共有 ${allCombos.length} 套不同可行组合，已展示 ${outcome.bundles.length} 套`, items: [], totalPrice: 0, budgetDiff: 0, compositeScore: 0 } as never)
  }

  outcome.bundles.sort((a, b) => b.compositeScore - a.compositeScore)
}

// ===== 对比评分：复用推荐引擎的分项评分，供 /compare 页与对话比较指代共用 =====
export interface ComparisonScore {
  productId: string
  card: RecCard
}

export function scoreForComparison(products: Product[], s: SlotsInput): ComparisonScore[] {
  const prices = products.map((p) => p.price)
  const setRange = { min: Math.min(...(prices.length ? prices : [0])), max: Math.max(...(prices.length ? prices : [1])) }
  return products.map((p) => {
    const weights = adjustWeights(p.category, s.preferences, undefined, s.localNeeds, s.cheapPreference)
    const req = budgetReqFor(p.category, s)
    const card = buildCard(p, s, weights, req, setRange)
    return { productId: p.id, card }
  })
}
