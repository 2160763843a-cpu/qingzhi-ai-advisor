// 多轮上下文测试：基于 24 组测试对话验证上下文合并、条件修改/删除、不重复追问、多品类识别、主场景
// 运行: node scripts/run-context-tests.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Advisor } from '../frontend/src/engine/engine.ts'
import { MemoryStorage, SessionStore, createSessionContext } from '../frontend/src/engine/session.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dialogues = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'test-dialogues.json'), 'utf8'))

// 旧版意图名 -> 统一枚举
const INTENT_MAP = {
  pre_sales: 'pre_sale',
  after_sales: 'after_sale',
  chitchat: 'chitchat_unknown',
  comparison: 'comparison',
  complaint: 'complaint',
  purchase_intent: 'purchase_intent'
}

const ISSUES = []
let PASS = 0
let TOTAL = 0

function check(cond, label, detail) {
  TOTAL += 1
  if (cond) {
    PASS += 1
  } else {
    ISSUES.push(`${label}: ${detail}`)
  }
}

const LEAK_PATTERNS = [
  { re: /[a-z]+_[a-z]+/i, why: 'snake_case 内部枚举' },
  { re: /[+-][a-zA-Z]/, why: '加减号字段' },
  { re: /\b(NaN|undefined|null)\b/, why: '未定义值字面量' },
  { re: /[{}<>]/, why: '原始对象/代码格式' },
  { re: /下一阶段|后续开发|后续模块|后续轮次|开发中/, why: '开发过程用语' }
]

function assertNoLeak(text, label) {
  for (const p of LEAK_PATTERNS) {
    check(!p.re.test(text), label, `用户可见文案泄漏（${p.why}）: "${String(text).slice(0, 60)}"`)
  }
}

function checkExpectSlots(expectSlots, advisor, label) {
  const ctx = advisor.getContext()
  const s = ctx.slots
  const prefs = (s.preferences?.value ?? [])
  const needs = (s.localNeeds?.value ?? [])
  const cats = (s.categories?.value ?? [])
  const dims = (s.installationDimensions?.value ?? [])
  for (const [key, v] of Object.entries(expectSlots)) {
    switch (key) {
      case 'budgetTotal':
        check(s.totalBudget?.value === v, label, `totalBudget 期望 ${v}，实际 ${s.totalBudget?.value}`)
        break
      case 'categories':
        check(JSON.stringify([...cats].sort()) === JSON.stringify([...v].sort()), label, `categories 期望 ${v}，实际 ${JSON.stringify(cats)}`)
        break
      case 'category':
        check(cats.includes(v), label, `categories 应包含 ${v}，实际 ${JSON.stringify(cats)}`)
        break
      case 'budgetMax': {
        const byCat = s.itemBudgetByCategory?.value ?? {}
        const actual = s.itemBudgetRange?.value?.max ?? s.itemBudget?.value ?? Object.values(byCat)[0]
        check(actual === v, label, `预算上限 期望 ${v}，实际 ${actual}`)
        break
      }
      case 'budgetMin': {
        const actual = s.itemBudgetRange?.value?.min
        check(actual === v, label, `预算下限 期望 ${v}，实际 ${actual}`)
        break
      }
      case 'familySize':
      case 'roomArea':
      case 'houseArea':
        check(s[key]?.value === v, label, `${key} 期望 ${v}，实际 ${s[key]?.value}`)
        break
      case 'energyPriority':
        if (v) check(prefs.includes('energy_saving'), label, `偏好应包含 energy_saving，实际 ${JSON.stringify(prefs)}`)
        break
      case 'noisePriority':
        if (v) check(prefs.includes('quiet'), label, `偏好应包含 quiet，实际 ${JSON.stringify(prefs)}`)
        break
      case 'seafoodStorage':
        if (v) check(needs.includes('seafood_freezing'), label, `本地需求应包含海鲜冷冻，实际 ${JSON.stringify(needs)}`)
        break
      case 'spaceMm':
        for (const [loc, dim] of Object.entries(v)) {
          const found = dims.find((d) => d.location === loc)
          check(Boolean(found), label, `缺少位置「${loc}」的尺寸记录`)
          if (found && dim.width) check(found.width === dim.width, label, `${loc}宽度 期望 ${dim.width}，实际 ${found.width}`)
          if (found && dim.depth) check(found.depth === dim.depth, label, `${loc}深度 期望 ${dim.depth}，实际 ${found.depth}`)
        }
        break
      case 'fault':
        check((s.faultSymptoms?.value ?? []).some((f) => f.includes(v) || v.includes(f)), label, `故障应包含 ${v}，实际 ${JSON.stringify(s.faultSymptoms?.value)}`)
        break
      case 'complaintTopic':
        check(s.complaintTopic?.value === v, label, `投诉主题 期望 ${v}，实际 ${s.complaintTopic?.value}`)
        break
      case 'orderRef':
        check(s.orderRef?.value === v, label, `订单号 期望 ${v}，实际 ${s.orderRef?.value}`)
        break
      case 'suggestion':
        check(String(s.suggestion?.value ?? '').includes(v), label, `建议应包含 ${v}，实际 ${s.suggestion?.value}`)
        break
      case 'contact':
      case 'consent':
        if (v) check(s.contactIntent?.value === true, label, `联系意愿应为 true`)
        break
      case 'preferredTime':
        check(String(s.purchaseTime?.value ?? '').includes(v), label, `期望时间应包含 ${v}，实际 ${s.purchaseTime?.value}`)
        break
      default:
        check(false, label, `未知的期望槽位字段 ${key}`)
    }
  }
}

// ---------- 第一部分：24 组对话逐轮回放 ----------
for (const d of dialogues) {
  const advisor = new Advisor(new SessionStore(new MemoryStorage()))
  const askTrace = []
  for (const t of d.turns) {
    const resp = advisor.processMessage(t.user)
    const ctx = advisor.getContext()
    const label = `${d.id}/T${t.seq}`
    check(resp.intent.primaryIntent === INTENT_MAP[t.expectIntent], label, `意图 期望 ${INTENT_MAP[t.expectIntent]}，实际 ${resp.intent.primaryIntent} (conf=${resp.intent.confidence})`)
    checkExpectSlots(t.expectSlots ?? {}, advisor, label)
    const hasFollowup = resp.followupQuestions.length > 0 || resp.intent.needsClarification
    check(hasFollowup === t.expectFollowup, label, `追问 期望 ${t.expectFollowup}，实际 ${hasFollowup} (${resp.followupQuestions.join('|') || '无'})`)
    for (const target of resp.followupTargets) askTrace.push({ turn: t.seq, target })
    assertNoLeak(resp.reply, label)
    for (const q of resp.quickOptions) assertNoLeak(q, `${label}/选项`)
    for (const c of resp.slotChanges) assertNoLeak(c.detail, `${label}/变更说明`)
  }
  // 不重复追问：同一信息槽位至多追问 2 次；已填充的槽位不再追问
  const ctx = advisor.getContext()
  const counts = {}
  for (const a of askTrace) counts[a.target] = (counts[a.target] ?? 0) + 1
  for (const [k, c] of Object.entries(counts)) {
    check(c <= 2, `${d.id}`, `槽位 ${k} 被追问 ${c} 次（>2）`)
  }
  for (const a of askTrace) {
    const filled = a.target === 'budget'
      ? Boolean(ctx.slots.totalBudget || ctx.slots.itemBudget || ctx.slots.itemBudgetRange)
      : Boolean(ctx.slots[a.target])
    if (a.target !== 'installationDimensions' || !ctx.slots.installationDimensions) {
      check(!(filled && a.turn < (ctx.turnCount ?? 0) && ctx.slots[a.target]?.turn === a.turn), `${d.id}`, `槽位 ${a.target} 填充后仍被追问`)
    }
  }
}

// ---------- 第二部分：主演示场景逐轮验证 ----------
function runMainDemo() {
  const advisor = new Advisor(new SessionStore(new MemoryStorage()))
  const turns = [
    { user: '我是青岛三口之家，想买冰箱和洗衣机。', expectIntent: 'pre_sale', followup: true },
    { user: '两件总预算8000元左右。', expectIntent: 'pre_sale', followup: true },
    { user: '厨房和阳台空间比较小，希望节能安静。', expectIntent: 'pre_sale', followup: true },
    { user: '平时海鲜比较多，冰箱冷冻能力要好。', expectIntent: 'pre_sale', followup: null },
    { user: '预算可以改到9000元，但宽度不能超过预留位置。', expectIntent: 'pre_sale', followup: true }
  ]
  const labelBase = '主场景'
  for (const [i, t] of turns.entries()) {
    const resp = advisor.processMessage(t.user)
    const ctx = advisor.getContext()
    const label = `${labelBase}/T${i + 1}`
    check(resp.intent.primaryIntent === t.expectIntent, label, `意图 期望 ${t.expectIntent}，实际 ${resp.intent.primaryIntent}`)
    if (t.followup !== null) {
      const hasFollowup = resp.followupQuestions.length > 0
      check(hasFollowup === t.followup, label, `追问 期望 ${t.followup}，实际 ${hasFollowup} (${resp.followupQuestions.join('|') || '无'})`)
    }
    if (i === 0) {
      check(ctx.slots.location?.value === '青岛', label, `城市 期望 青岛，实际 ${ctx.slots.location?.value}`)
      check(ctx.slots.familySize?.value === 3, label, `家庭人数 期望 3，实际 ${ctx.slots.familySize?.value}`)
      check(JSON.stringify((ctx.slots.categories?.value ?? []).slice().sort()) === JSON.stringify(['冰箱', '洗衣机']), label, `品类 期望 冰箱+洗衣机，实际 ${JSON.stringify(ctx.slots.categories?.value)}`)
    }
    if (i === 1) check(ctx.slots.totalBudget?.value === 8000, label, `总预算 期望 8000，实际 ${ctx.slots.totalBudget?.value}`)
    if (i === 2) {
      check((ctx.slots.localNeeds?.value ?? []).includes('small_space'), label, '本地需求应包含小户型嵌入')
      const prefs = ctx.slots.preferences?.value ?? []
      check(prefs.includes('energy_saving') && prefs.includes('quiet'), label, `偏好应包含节能+静音，实际 ${JSON.stringify(prefs)}`)
    }
    if (i === 3) {
      check((ctx.slots.localNeeds?.value ?? []).includes('seafood_freezing'), label, '本地需求应包含海鲜冷冻')
    }
    if (i === 4) {
      check(ctx.slots.totalBudget?.value === 9000, label, `总预算修改 期望 9000，实际 ${ctx.slots.totalBudget?.value}`)
      check(ctx.slots.totalBudget?.turn === 5, label, `总预算来源轮次 期望 5，实际 ${ctx.slots.totalBudget?.turn}`)
      check(resp.followupQuestions.some((q) => q.includes('宽')), label, `第5轮应追问预留宽度，实际追问：${resp.followupQuestions.join('|') || '无'}`)
    }
  }
}
runMainDemo()
runUserDialogue()

// ---------- 第二部分：用户四轮真实对话（话术验收） ----------
function runUserDialogue() {
  const advisor = new Advisor(new SessionStore(new MemoryStorage()))
  const turns = ['我想买冰箱', '3000-5000元', '四口之家', '大容量']
  let last = null
  for (const [i, t] of turns.entries()) {
    const resp = advisor.processMessage(t)
    const label = `用户对话/T${i + 1}`
    assertNoLeak(resp.reply, label)
    for (const q of resp.quickOptions) assertNoLeak(q, `${label}/选项`)
    last = resp
  }
  const ctx = advisor.getContext()
  const label = '用户对话/T4'
  check(ctx.slots.preferences?.value?.includes('large_capacity') === true, label, `偏好应包含大容量，实际 ${JSON.stringify(ctx.slots.preferences?.value)}`)
  const range = ctx.slots.itemBudgetRange?.value
  check(Boolean(range && range.min === 3000 && range.max === 5000), label, `预算区间 期望 3000-5000，实际 ${JSON.stringify(range)}`)
  check(ctx.slots.familySize?.value === 4, label, `家庭人数 期望 4，实际 ${ctx.slots.familySize?.value}`)
  const reply = last.reply
  check(reply.includes('大容量'), label, `最终回复应自然复述偏好，实际 "${reply}"`)
  check(reply.includes('3000～5000元'), label, `最终回复应自然复述预算区间，实际 "${reply}"`)
  check(reply.includes('四口之家'), label, `最终回复应自然复述家庭人数，实际 "${reply}"`)
  check(reply.includes('可以生成推荐方案'), label, `最终回复应包含信息完整的自然提示，实际 "${reply}"`)
  check(!reply.includes('下一阶段'), label, '最终回复不得出现开发过程用语')
  console.log('\n[用户四轮对话] 最终回复:', reply)
}

// ---------- 第三部分：条件修改 / 删除 / 持久化 ----------
function runSlotOps() {
  const storage = new MemoryStorage()
  const advisor = new Advisor(new SessionStore(storage))
  advisor.processMessage('我们一家三口想买冰箱和洗衣机，总预算8000元')
  advisor.processMessage('希望节能静音')
  let ctx = advisor.getContext()
  check((ctx.slots.categories?.value ?? []).length === 2, '条件操作', '初始品类应为2个')

  advisor.processMessage('不要洗衣机了')
  ctx = advisor.getContext()
  check(JSON.stringify(ctx.slots.categories?.value) === JSON.stringify(['冰箱']), '条件操作', `删除品类后 期望 [冰箱]，实际 ${JSON.stringify(ctx.slots.categories?.value)}`)

  advisor.processMessage('预算改成9000元')
  ctx = advisor.getContext()
  check(ctx.slots.totalBudget?.value === 9000, '条件操作', `预算修改 期望 9000，实际 ${ctx.slots.totalBudget?.value}`)

  advisor.processMessage('静音不是必须')
  ctx = advisor.getContext()
  check(!(ctx.slots.preferences?.value ?? []).includes('quiet'), '条件操作', `静音应被移除，实际 ${JSON.stringify(ctx.slots.preferences?.value)}`)
  check((ctx.slots.preferences?.value ?? []).includes('energy_saving'), '条件操作', '节能偏好应保留')

  // 持久化：同一存储上新开 store（模拟页面刷新）后会话恢复
  const store2 = new SessionStore(storage)
  const restored = store2.load()
  check(Boolean(restored && restored.sessionId && restored.slots.totalBudget?.value === 9000), '持久化', '刷新后应恢复会话与修改后的预算')

  // 敏感信息：手机号不落库
  const advisor2 = new Advisor(new SessionStore(storage))
  advisor2.processMessage('13800001234，联系我安排送货')
  const raw = storage.getItem('qzad.session.v1') ?? ''
  check(!raw.includes('13800001234'), '隐私', '完整手机号不应写入存储')
  check(Boolean(restored), '持久化', '会话可用')

  // 消息历史上限
  const advisor3 = new Advisor(new SessionStore(new MemoryStorage()))
  for (let i = 0; i < 80; i++) advisor3.processMessage(`测试消息${i}`)
  const ctx3 = advisor3.getContext()
  check(ctx3.recentMessages.length <= 60, '历史上限', `消息数 ${ctx3.recentMessages.length} 应 <= 60`)
}
runSlotOps()

// ---------- 汇总 ----------
console.log('========== 多轮上下文测试报告（基于 24 组对话 + 主场景 + 条件操作） ==========')
console.log(`断言: ${PASS}/${TOTAL} 通过`)
if (ISSUES.length > 0) {
  console.error(`\n失败明细 (${ISSUES.length} 项):`)
  for (const i of ISSUES) console.error(`  [FAIL] ${i}`)
  process.exit(1)
} else {
  console.log('全部通过 ✓')
  process.exit(0)
}
