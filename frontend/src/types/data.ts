export type Category = '冰箱' | '洗衣机' | '空调' | '热水器' | '电视' | '洗碗机'

export type SafetyLevel = 'high' | 'medium' | 'low'

export type IntentKey =
  | 'pre_sales'
  | 'comparison'
  | 'after_sales'
  | 'complaint'
  | 'purchase_intent'
  | 'chitchat'

export const CATEGORIES: Category[] = ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机']

export const CATEGORY_CODES: Record<Category, string> = {
  冰箱: 'RF',
  洗衣机: 'WM',
  空调: 'AC',
  热水器: 'WH',
  电视: 'TV',
  洗碗机: 'DW'
}

export const DATA_SOURCE_MARK = '模拟数据，仅供演示'

export interface DimensionsMm {
  width: number
  height: number
  depth: number
}

export interface NoiseDb {
  standard: number
  max: number
}

interface ProductBase {
  id: string
  name: string
  brand: string
  category: Category
  price: number
  priceBand: string
  energyGrade: string
  noiseDb: NoiseDb
  dimensionsMm: DimensionsMm
  familySizeFit: [number, number]
  suitableArea: [number, number] | null
  rating: number
  stockStatus: '有货' | '库存紧张' | '预售'
  afterSalesNote: string
  tags: string[]
  sellingPoints: string[]
  limitations: string[]
  dataSource: string
}

export interface FridgeProduct extends ProductBase {
  category: '冰箱'
  capacityL: number
  freezerCapacityL: number
  deepFreeze: boolean
}

export interface WasherProduct extends ProductBase {
  category: '洗衣机'
  washCapacityKg: number
  spinSpeedRpm: number
}

export interface AcProduct extends ProductBase {
  category: '空调'
  horsepower: number
}

export interface WaterHeaterProduct extends ProductBase {
  category: '热水器'
  literL: number
  heatType: string
}

export interface TvProduct extends ProductBase {
  category: '电视'
  inchSize: number
  resolution: string
}

export interface DishwasherProduct extends ProductBase {
  category: '洗碗机'
  placeSets: number
  dryType: string
}

export type Product =
  | FridgeProduct
  | WasherProduct
  | AcProduct
  | WaterHeaterProduct
  | TvProduct
  | DishwasherProduct

export type FaqCategory =
  | '售前选购'
  | '产品参数'
  | '配送'
  | '安装'
  | '使用方法'
  | '保修'
  | '退换'
  | '维修'
  | '清洗保养'
  | '投诉建议'

export interface Faq {
  id: string
  category: FaqCategory
  applicableCategories: string[]
  question: string
  keywords: string[]
  answer: string
  sourceNote: string
  safetyLevel: SafetyLevel
}

export interface DialogueTurn {
  seq: number
  user: string
  expectIntent: IntentKey | null
  expectSlots: Record<string, unknown>
  expectFollowup: boolean
  expectPath: string
  expectCategory?: string[]
}

export interface TestDialogue {
  id: string
  scenario: string
  intent: IntentKey
  title: string
  turns: DialogueTurn[]
  dataSource: string
}
