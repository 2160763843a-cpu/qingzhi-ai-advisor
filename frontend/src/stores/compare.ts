// 全站共用对比状态：Vue 响应式实现，商品库 / 智能顾问 / 推荐卡 / 对比页订阅同一份状态
import { computed, reactive } from 'vue'
import type { Product } from '../types/data.ts'
import { getAppAnalyticsStore } from './analytics.ts'

export type CompareSource = '推荐卡' | '候选列表' | '商品库' | '聊天指令'
export const MAX_COMPARE = 3

export interface CompareItem {
  productId: string
  name: string
  brand: string
  category: string
  price: number
  addedFrom: CompareSource
  addedAt: number
  product: Product
}

export type CompareEventType =
  | 'compare_item_added'
  | 'compare_item_removed'
  | 'compare_started'
  | 'compare_viewed'
  | 'compare_difference_only'
  | 'compare_recommendation_clicked'
  | 'compare_cleared'

export interface CompareEvent {
  eventId: string
  type: CompareEventType
  sessionId: string
  productId: string | null
  category: string | null
  at: number
  source: CompareSource | null
}

export interface AddResult {
  ok: boolean
  code?: 'duplicate' | 'full' | 'category_mismatch'
  existingCategory?: string
  existingName?: string
  started?: boolean
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryCompareStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  setItem(key: string, value: string): void { this.map.set(key, value) }
  removeItem(key: string): void { this.map.delete(key) }
}

function randId(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}-${s}`
}

export class CompareStore {
  // 响应式状态：先改状态，后持久化；所有组件共享同一实例
  items = reactive<CompareItem[]>([])
  events = reactive<CompareEvent[]>([])
  private readonly _count = computed(() => this.items.length)
  private readonly _canCompare = computed(() => this.items.length >= 2)
  private readonly _isFull = computed(() => this.items.length >= MAX_COMPARE)
  private readonly _category = computed(() => this.items[0]?.category ?? '')
  get count(): number { return this._count.value }
  get canCompare(): boolean { return this._canCompare.value }
  get isFull(): boolean { return this._isFull.value }
  get category(): string { return this._category.value }
  private storage: StorageLike
  private key: string
  sessionId: string
  private startedFired = false
  private lastViewedAt = 0

  constructor(storage: StorageLike, key = 'qzad.compare.v1', sessionId = 'S-local') {
    this.storage = storage
    this.key = key
    this.sessionId = sessionId
    this.restore()
  }

  has(productId: string): boolean {
    return this.items.some((i) => i.productId === productId)
  }

  add(product: Product, source: CompareSource): AddResult {
    if (this.has(product.id)) return { ok: false, code: 'duplicate' }
    if (this.items.length >= MAX_COMPARE) return { ok: false, code: 'full' }
    if (this.items.length > 0 && this.items[0].category !== product.category) {
      return { ok: false, code: 'category_mismatch', existingCategory: this.items[0].category, existingName: this.items[0].name }
    }
    this.items.push({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      addedFrom: source,
      addedAt: Date.now(),
      product
    })
    this.record('compare_item_added', product.id, product.category, source)
    let started = false
    if (this.items.length >= 2 && !this.startedFired) {
      this.startedFired = true
      started = true
      this.record('compare_started', null, product.category, source)
    }
    this.persist()
    return { ok: true, started }
  }

  remove(productId: string, source: CompareSource | null = null): boolean {
    return this.removeById(productId, source)
  }

  removeById(productId: string, source: CompareSource | null = null): boolean {
    const item = this.items.find((i) => i.productId === productId)
    if (!item) return false
    this.items.splice(this.items.indexOf(item), 1)
    this.record('compare_item_removed', productId, item.category, source)
    this.persist()
    return true
  }

  replaceWith(product: Product, source: CompareSource): void {
    this.items.splice(0, this.items.length)
    this.record('compare_cleared', null, null, source)
    this.add(product, source)
  }

  clear(source: CompareSource | null = null): void {
    if (this.items.length === 0) return
    this.items.splice(0, this.items.length)
    this.record('compare_cleared', null, null, source)
    this.persist()
  }

  prune(validIds: string[]): CompareItem[] {
    const valid = new Set(validIds)
    const removed = this.items.filter((i) => !valid.has(i.productId))
    if (removed.length > 0) {
      for (const r of removed) this.record('compare_item_removed', r.productId, r.category, null)
      for (const r of removed) this.items.splice(this.items.indexOf(r), 1)
      this.persist()
    }
    return removed
  }

  recordView(): void {
    const now = Date.now()
    if (now - this.lastViewedAt < 10_000) return
    this.lastViewedAt = now
    this.record('compare_viewed', null, this.items[0]?.category ?? null, null)
    getAppAnalyticsStore().track('compare_viewed', { sessionId: this.sessionId, opKey: 'viewed' })
    this.persist()
  }

  recordDifferenceOnly(): void {
    this.record('compare_difference_only', null, this.items[0]?.category ?? null, null)
    getAppAnalyticsStore().track('compare_difference_only', { sessionId: this.sessionId, opKey: 'diff' })
    this.persist()
  }

  recordRecommendationClicked(): void {
    this.record('compare_recommendation_clicked', null, this.items[0]?.category ?? null, null)
    this.persist()
  }

  persist(): void {
    this.events.splice(0, this.events.length - 100)
    try {
      this.storage.setItem(this.key, JSON.stringify({ items: this.items, events: this.events, meta: { startedFired: this.startedFired } }))
    } catch { /* 存储不可用时仅保留内存状态 */ }
  }

  restore(): void {
    try {
      const raw = this.storage.getItem(this.key)
      if (!raw) return
      const parsed = JSON.parse(raw)
      this.items.splice(0, this.items.length, ...(Array.isArray(parsed.items) ? parsed.items : []))
      this.events.splice(0, this.events.length, ...(Array.isArray(parsed.events) ? parsed.events : []))
      this.startedFired = Boolean(parsed.meta?.startedFired)
    } catch {
      // localStorage 损坏：安全回退为空状态，不抛错
      this.items.splice(0, this.items.length)
      this.events.splice(0, this.events.length)
    }
  }

  private record(type: CompareEventType, productId: string | null, category: string | null, source: CompareSource | null): void {
    this.events.push({ eventId: randId('CE'), type, sessionId: this.sessionId, productId, category, at: Date.now(), source })
  }
}

let singleton: CompareStore | null = null
export function getAppCompareStore(): CompareStore {
  if (singleton) return singleton
  let storage: StorageLike
  try {
    const probe = '__qzad_cmp_probe__'
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    storage = globalThis.localStorage
  } catch {
    storage = new MemoryCompareStorage()
  }
  let sessionId = 'S-local'
  try {
    sessionId = JSON.parse(globalThis.localStorage.getItem('qzad.session.v1') ?? '{}').sessionId ?? 'S-local'
  } catch { /* 忽略 */ }
  singleton = new CompareStore(storage, 'qzad.compare.v1', sessionId)
  return singleton
}
