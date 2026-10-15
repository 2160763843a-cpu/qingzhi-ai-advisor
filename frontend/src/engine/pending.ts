// PendingStateResolver：上下文短回答解析器
// 短回答（愿意/需要/可以/暂不需要…）脱离上下文没有确定含义，必须结合 pendingAsk 才能解释。
import type { PrefKey, SlotKey } from './types.ts'

// 偏好同义表达（结合“您更看重…”的上下文才生效）
const PREF_GROUPS: { key: PrefKey; re: RegExp }[] = [
  { key: 'cost_effective', re: /性价比|划算|实惠|便宜又好用|同配置选便宜的|预算花得值|品牌溢价|便宜点/ },
  { key: 'energy_saving', re: /节能|省电|电费|一级能效|别太费电|费电/ },
  { key: 'quiet', re: /静音|安静|噪声|噪音|吵|睡眠浅/ },
  { key: 'large_capacity', re: /大容量|容量越大|能多装|东西(比较)?多|人口多|多装/ },
  { key: 'easy_operation', re: /操作简单|老人方便|简单一点|简单好用|好操作|老人用/ },
  { key: 'smart', re: /智能化|智能/ },
  { key: 'easy_clean', re: /好清洁|易清洁|好打理/ },
  { key: 'durable', re: /耐用|皮实/ },
  { key: 'good_service', re: /售后方便|售后好|服务好/ }
]

export interface PrefAnswer { add: PrefKey[]; remove: PrefKey[]; none?: boolean }

// “晚上不要吵/噪声别太大”是正向静音诉求，先归一化再判断
function normalizeQuiet(text: string): string {
  return text
    .replace(/(噪声|噪音)别?太大/g, '安静')
    .replace(/晚上?不要?太?吵/g, '安静')
    .replace(/别太吵|不要吵|不吵/g, '安静')
}

export function resolvePreferenceAnswer(text: string): PrefAnswer | null {
  const t = normalizeQuiet(text)
  const hasHit = PREF_GROUPS.some((g) => g.re.test(t))
  if (/随便|没有特别偏好|没什么(特别)?要求|都可以|没有偏好/.test(t) && !hasHit) return { add: [], remove: [], none: true }
  if (!hasHit) return null
  const clauses = t.split(/[，。,；;]+/)
  const negCue = /(不要|不是重点|不重要|无所谓|无需|不需要|不追求|没有特别偏好)/
  const add: PrefKey[] = []
  const remove: PrefKey[] = []
  for (const g of PREF_GROUPS) {
    let hit = false
    let neg = false
    for (const cl of clauses) {
      if (!g.re.test(cl)) continue
      if (negCue.test(cl)) neg = true
      else hit = true
    }
    if (neg) remove.push(g.key)
    else if (hit) add.push(g.key)
  }
  if (add.length === 0 && remove.length === 0) return null
  return { add, remove }
}

export const AFFIRM_PHRASES = ['愿意', '需要', '可以', '好', '好的', '行', '没问题', '同意', '是', '对', '帮我登记', '麻烦跟进', '那就这样办', '要', '嗯', 'ok']
export const NEGATE_PHRASES = ['不愿意', '不需要', '暂不需要', '先不用', '不用了', '算了', '否', '不同意', '不要联系', '我再考虑', '先别登记', '不用', '不要', '没解决', '未解决', '还没有', '没有']

const BOOLEAN_SLOTS: SlotKey[] = ['contactWillingness', 'kbResolution', 'safetyConfirmed', 'leadConsent']
const OPTION_SLOTS: SlotKey[] = ['complaintResolution', 'faultSymptoms', 'faultDuration', 'purchaseTime', 'location', 'installationDimensions']

export interface PendingAnswer {
  kind: 'affirm' | 'negate' | 'option'
  option?: string
  pref?: PrefAnswer
}

function isShort(text: string): boolean {
  return text.length <= 8
}

function phraseHit(text: string, phrases: string[]): boolean {
  if (phrases.includes(text)) return true
  return isShort(text) && phrases.some((p) => text.includes(p))
}

export const PENDING_QUESTIONS: Partial<Record<SlotKey, string>> = {
  contactWillingness: '是否需要为你登记一条模拟投诉/售后记录（仅本地演示，不会提交给真实企业）？',
  kbResolution: '请问按以上步骤操作后问题解决了吗？',
  safetyConfirmed: '为确保安全，请问您已经断电或关闭燃气阀门了吗？'
}

// 返回 null 表示本轮短回答无法从上下文解释，应进入后续正常管线
export function resolvePendingAnswer(text: string, pendingSlot: SlotKey | null): PendingAnswer | null {
  if (!pendingSlot) return null
  if (pendingSlot === 'kbResolution') {
    if (/已解决|解决了|好了|解决啦|解决了呀/.test(text) || (isShort(text) && phraseHit(text, ['好', '可以', '是', '对']))) return { kind: 'affirm' }
    if (/未解决|没解决|还是不行|不行|没有解决|还没/.test(text) || phraseHit(text, ['没有'])) return { kind: 'negate' }
    return null
  }
  if (pendingSlot === 'safetyConfirmed') {
    if (/已断电|断电了|已经断电|关了|已关|关阀|已关闭/.test(text)) return { kind: 'affirm' }
    if (/还没有|还没|没有/.test(text)) return { kind: 'negate' }
    // 愿意/需要等答案对“是否已断电”没有意义：显式标记无效，继续澄清
    return phraseHit(text, AFFIRM_PHRASES) || phraseHit(text, NEGATE_PHRASES) ? { kind: 'option', option: '__invalid__' } : null
  }
  if (pendingSlot === 'contactWillingness') {
    // 带明确业务动作的表达（安排检测/上门/换修等）交回完整意图管线，不当作纯确认
    if (/安排|检测|上门|换|修|预约|下单|退货|退款|送货/.test(text)) return null
    // 先判否定，避免“暂不需要”被“需要”子串误判为肯定
    if (phraseHit(text, NEGATE_PHRASES)) return { kind: 'negate' }
    if (phraseHit(text, AFFIRM_PHRASES)) return { kind: 'affirm' }
    return null
  }
  if (pendingSlot === ('preferences' as SlotKey)) {
    const pa = resolvePreferenceAnswer(text)
    if (pa) return { kind: 'option', option: '__preferences__', pref: pa } as PendingAnswer
    return null
  }
  if (OPTION_SLOTS.includes(pendingSlot)) {
    const options = pendingOptions(pendingSlot)
    const hit = options.find((o) => text === o || (isShort(text) && (o.includes(text) || text.includes(o))))
    if (hit) return { kind: 'option', option: hit }
    return null
  }
  return null
}

// 与 followup.ts 的 OPTIONS 保持同步的本地副本（避免循环依赖）
function pendingOptions(slot: SlotKey): string[] {
  const map: Partial<Record<SlotKey, string[]>> = {
    complaintResolution: ['尽快送达', '上门检测', '退款或换货', '道歉解释'],
    faultSymptoms: ['不制冷', '不脱水', '漏水', '异响', '不制热'],
    faultDuration: ['刚出现', '一周内', '一个月以上'],
    purchaseTime: ['这周内', '一个月内', '先了解一下'],
    location: ['青岛市区', '青岛郊区', '其他城市'],
    installationDimensions: ['宽60公分以内', '宽75公分以内', '宽90公分以内', '还不确定'],
    categories: ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机']
  }
  return map[slot] ?? []
}

export function isBooleanPending(slot: SlotKey | null | undefined): boolean {
  return Boolean(slot && BOOLEAN_SLOTS.includes(slot))
}
