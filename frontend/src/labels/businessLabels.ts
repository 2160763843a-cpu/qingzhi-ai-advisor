// 业务枚举唯一中文映射
export const RECORD_TYPE: Record<string, string> = { purchase_lead: '购买线索', after_sales_case: '售后工单', complaint_case: '投诉记录' }
export const ROLE: Record<string, string> = { consumer: '消费者视角', operator: '运营视角' }
export const LEVEL: Record<string, string> = { high: '高意向', medium: '中意向', low: '低意向', '高': '高意向', '中': '中意向', '低': '低意向' }
export const ORIGIN: Record<string, string> = { actual: '实际演示数据', sample: '示例数据' }
export const AUDIT_ACTION: Record<string, string> = { lead_created: '创建线索', lead_status_changed: '状态变更', lead_consent_granted: '同意联系', lead_consent_declined: '拒绝联系', lead_consent_requested: '询问联系授权', lead_score_updated: '意向评分更新', consent_withdrawn: '撤回授权', record_deleted: '删除记录', lead_deleted: '删除记录', lead_exported: '导出数据', after_sales_case_created: '创建售后工单', complaint_case_created: '创建投诉记录', sensitive_contact_viewed: '查看完整联系方式', role_switch_operator: '切换演示视角', role_switch_consumer: '切换演示视角', analytics_events_cleared: '清除分析事件' }
export const SOURCE: Record<string, string> = { chat: '智能顾问', recommendation: '推荐方案', product_library: '商品库', compare: '商品对比', dashboard: '运营看板', '推荐卡': '推荐方案', '商品库': '商品库', '聊天指令': '智能顾问', '候选列表': '推荐方案' }
export function tr(map: Record<string, string>, key: string | null | undefined, fallback = ''): string {
  if (key === null || key === undefined || key === '') return fallback
  return map[key] ?? key
}
