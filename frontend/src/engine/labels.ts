// 统一的用户可见中文映射（唯一来源）：所有聊天消息、需求摘要、标签、按钮、提示
// 中的枚举值都必须经过本模块转换，禁止在组件内重复维护映射或直接输出英文枚举。
import type { IntentKey, PrefKey, LocalNeedKey, SlotKey } from './types.ts'

export const INTENT_LABELS: Record<IntentKey, string> = {
  pre_sale: '售前咨询',
  comparison: '产品比较',
  after_sale: '售后问题',
  complaint: '投诉建议',
  purchase_intent: '购买/预约意向',
  chitchat_unknown: '闲聊/无明确意图'
}

export const PREF_LABELS: Record<PrefKey, string> = {
  energy_saving: '节能',
  quiet: '静音',
  large_capacity: '大容量',
  cost_effective: '性价比',
  durable: '耐用',
  easy_clean: '易清洁',
  good_service: '售后方便',
  smart: '智能化',
  easy_operation: '操作简便'
}

export const LOCAL_NEED_LABELS: Record<LocalNeedKey, string> = {
  moisture_proof: '防潮',
  seafood_freezing: '海鲜冷冻',
  small_space: '小空间',
  embedded_installation: '嵌入式安装',
  durable_rental: '民宿耐用'
}

export const SLOT_LABELS: Record<SlotKey, string> = {
  categories: '关注品类',
  totalBudget: '总预算(元)',
  totalBudgetMin: '总预算下限(元)',
  leadConsent: '联系授权',
  depthUnknown: '深度未知',
  dimensionsSkipped: '尺寸已跳过',
  itemBudget: '单品预算(元)',
  itemBudgetRange: '单品预算区间(元)',
  itemBudgetByCategory: '分品类预算(元)',
  familySize: '家庭人数',
  familySizeMin: '家庭人数下限',
  houseArea: '住房面积(㎡)',
  roomArea: '房间面积(㎡)',
  installationDimensions: '安装空间(宽×深×高)',
  location: '所在城市',
  preferences: '偏好',
  localNeeds: '本地化需求',
  purchaseTime: '期望时间',
  ownedDuration: '已用年限',
  faultSymptoms: '故障现象',
  contactIntent: '联系/预约意愿',
  complaintTopic: '投诉主题',
  complaintResolution: '期望处理方式',
  faultDuration: '故障持续时间',
  safetyConfirmed: '安全确认',
  kbResolution: '问题是否解决',
  contactWillingness: '登记意愿',
  orderRef: '订单号',
  suggestion: '建议',
  budgetNote: '预算说明'
}

export function prefLabel(key: string): string {
  return PREF_LABELS[key as PrefKey] ?? key
}

export function localNeedLabel(key: string): string {
  return LOCAL_NEED_LABELS[key as LocalNeedKey] ?? key
}

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function familyPhrase(n: number): string {
  return n >= 1 && n <= 9 ? `${CN_NUM[n]}口之家` : `家庭人数 ${n} 人`
}
