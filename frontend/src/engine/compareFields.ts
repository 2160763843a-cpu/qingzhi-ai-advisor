// 对比矩阵字段配置：全部取自当前 120 个 SKU 的结构化数据，缺失显示“暂无数据”
import type { Product } from '../types/data.ts'

export interface CompareField {
  key: string
  label: string
  get(p: Product): string
}

function nd(v: unknown, fmt?: (x: never) => string): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '暂无数据'
  if (fmt) return fmt(v as never)
  return String(v)
}

const DIM = (p: Product): string => {
  const d = (p as Product & { dimensionsMm: { width: number; depth: number; height: number } }).dimensionsMm
  return d ? `宽${d.width}×深${d.depth}×高${d.height} mm` : '暂无数据'
}
const NOISE = (p: Product): string => {
  const n = (p as Product & { noiseDb: { standard: number; max: number } | number }).noiseDb
  if (n === null || n === undefined) return '暂无数据'
  if (typeof n === 'number') return `${n} dB`
  return `${n.standard} dB（最大 ${n.max}）`
}
const FLEX = (p: Product, re: RegExp): string => {
  const tags = ((p as Product & { tags: string[] }).tags ?? []) as string[]
  const hit = tags.find((t) => re.test(t))
  return hit ?? '暂无数据'
}

export function commonCompareFields(): CompareField[] {
  return [
    { key: 'name', label: '商品名称', get: (p) => p.name },
    { key: 'brand', label: '模拟品牌', get: (p) => p.brand },
    { key: 'price', label: '模拟价格', get: (p) => `${p.price} 元` },
    { key: 'energy', label: '能效等级', get: (p) => nd(p.energyGrade) },
    { key: 'noise', label: '噪声', get: (p) => NOISE(p) },
    { key: 'dims', label: '外形尺寸', get: (p) => DIM(p) },
    { key: 'stock', label: '库存状态', get: (p) => nd(p.stockStatus) },
    { key: 'afterSales', label: '售后说明', get: (p) => nd(p.afterSalesNote) },
    { key: 'points', label: '核心卖点', get: (p) => nd((p as Product & { sellingPoints: string[] }).sellingPoints, (x: string[]) => x.join('；')) },
    { key: 'limits', label: '注意事项', get: (p) => nd((p as Product & { limitations: string[] }).limitations, (x: string[]) => x.join('；')) }
  ]
}

export function compareFieldsFor(category: string): CompareField[] {
  const p = category
  const extra: CompareField[] = []
  if (p === '冰箱') {
    extra.push(
      { key: 'capacityL', label: '总容积', get: (x) => nd((x as Product & { capacityL: number }).capacityL, (v) => `${v} L`) },
      { key: 'freezer', label: '冷冻室容积', get: (x) => nd((x as Product & { freezerCapacityL: number }).freezerCapacityL, (v) => `${v} L`) },
      { key: 'deepFreeze', label: '深冷/速冻', get: (x) => ((x as Product & { deepFreeze: boolean }).deepFreeze ? '支持深冷速冻' : '不支持') },
      { key: 'familyFit', label: '适用家庭人数', get: (x) => fitText(x) },
      { key: 'door', label: '门体形式', get: (x) => FLEX(x, /门/) }
    )
  } else if (p === '洗衣机') {
    extra.push(
      { key: 'washKg', label: '洗涤容量', get: (x) => nd((x as Product & { washCapacityKg: number }).washCapacityKg, (v) => `${v} kg`) },
      { key: 'spin', label: '脱水转速', get: (x) => nd((x as Product & { spinSpeedRpm: number }).spinSpeedRpm, (v) => `${v} 转/分`) },
      { key: 'washMode', label: '洗涤方式', get: (x) => FLEX(x, /滚筒|波轮|迷你/) },
      { key: 'noise2', label: '噪声', get: (x) => NOISE(x) },
      { key: 'familyFit', label: '适用人数', get: (x) => fitText(x) }
    )
  } else if (p === '空调') {
    extra.push(
      { key: 'hp', label: '匹数', get: (x) => nd((x as Product & { horsepower: number }).horsepower, (v) => `${v} 匹`) },
      { key: 'area', label: '适用面积', get: (x) => areaText(x) },
      { key: 'coolHeat', label: '制冷/制热', get: (x) => FLEX(x, /冷暖|单冷|变频|壁挂|柜/) },
      { key: 'energy2', label: '能效', get: (x) => nd(x.energyGrade) },
      { key: 'noise2', label: '室内/室外噪声', get: (x) => NOISE(x) }
    )
  } else if (p === '热水器') {
    extra.push(
      { key: 'liter', label: '升数', get: (x) => nd((x as Product & { literL: number }).literL, (v) => `${v} L`) },
      { key: 'heatType', label: '加热类型', get: (x) => nd((x as Product & { heatType: string }).heatType) },
      { key: 'familyFit', label: '适用人数', get: (x) => fitText(x) },
      { key: 'install', label: '安装与安全', get: (x) => FLEX(x, /储水|即热|燃气|电热|安全/) }
    )
  } else if (p === '电视') {
    extra.push(
      { key: 'inch', label: '屏幕尺寸', get: (x) => nd((x as Product & { inchSize: number }).inchSize, (v) => `${v} 英寸`) },
      { key: 'res', label: '分辨率', get: (x) => nd((x as Product & { resolution: string }).resolution) },
      { key: 'viewDist', label: '建议观看距离', get: (x) => inchToDist(x) },
      { key: 'smart', label: '智能功能', get: (x) => FLEX(x, /智能|语音|4K|液晶/) }
    )
  } else if (p === '洗碗机') {
    extra.push(
      { key: 'sets', label: '套数', get: (x) => nd((x as Product & { placeSets: number }).placeSets, (v) => `${v} 套`) },
      { key: 'install', label: '安装方式', get: (x) => FLEX(x, /嵌入式|台式|独立|水槽/) },
      { key: 'dry', label: '烘干方式', get: (x) => FLEX(x, /烘干|余热|热风|冷凝/) || nd((x as Product & { dryType: string }).dryType) },
      { key: 'dims', label: '尺寸', get: (x) => DIM(x) },
      { key: 'noise2', label: '噪声', get: (x) => NOISE(x) }
    )
  }
  return extra
}

function fitText(p: Product): string {
  const f = (p as Product & { familySizeFit: [number, number] | null }).familySizeFit
  return f ? `${f[0]}～${f[1]} 口人` : '暂无数据'
}
function areaText(p: Product): string {
  const a = (p as Product & { suitableArea: [number, number] | null }).suitableArea
  return a ? `${a[0]}～${a[1]} ㎡` : '暂无数据'
}
function inchToDist(p: Product): string {
  const inch = (p as Product & { inchSize: number }).inchSize
  if (!inch) return '暂无数据'
  const lo = Math.round((inch * 2.54 * 2) / 100 * 10) / 10
  const hi = Math.round((inch * 2.54 * 3) / 100 * 10) / 10
  return `${lo}～${hi} 米`
}
