// 全项目唯一预算格式化出口：聊天、需求摘要、推荐条件、商品筛选共用
// 输入为归一化预算描述；任何用户可见区域禁止自行拼接预算字符串
export interface BudgetLike {
  min?: number | null
  max?: number | null
  exact?: number | null
  approximate?: number | null
  strictMax?: boolean
  moneyNotPrimary?: boolean
  perItem?: boolean
  scope?: string
  sourceText?: string
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function formatBudget(b: BudgetLike): string {
  if (b.moneyNotPrimary) return '价格不是首要条件'
  if (isNum(b.exact)) return `${b.exact}元`
  if (isNum(b.approximate)) return `约${b.approximate}元`
  const min = isNum(b.min) ? b.min : null
  const max = isNum(b.max) ? b.max : null
  if (min !== null && max !== null) return `${min}～${max}元`
  if (min !== null) return `${min}元以上`
  if (max !== null) return `${max}${b.strictMax ? '元（不超过）' : '元以内'}`
  return '未设置预算'
}

// 从会话槽位读取预算并归一化（聊天摘要/刷新恢复共用）
export function budgetFromSlots(slots: Record<string, { value: unknown } | undefined>): BudgetLike {
  const note = slots.budgetNote?.value
  if (typeof note === 'string' && note.includes('价格非首要条件')) return { moneyNotPrimary: true }
  const range = slots.itemBudgetRange?.value as { min?: number; max?: number } | undefined
  if (range && (isNum(range.min) || isNum(range.max))) {
    return { min: isNum(range.min) ? range.min : null, max: isNum(range.max) ? range.max : null }
  }
  const byCat = slots.itemBudgetByCategory?.value as Record<string, number> | undefined
  if (byCat && Object.keys(byCat).length > 0) {
    const v = Object.values(byCat).find(isNum)
    if (v !== undefined) return { exact: v, perItem: true, scope: Object.keys(byCat).join('、') }
  }
  if (isNum(slots.itemBudget?.value)) return { exact: slots.itemBudget?.value as number, perItem: true }
  if (isNum(slots.totalBudget?.value)) return { exact: slots.totalBudget?.value as number }
  return {}
}
