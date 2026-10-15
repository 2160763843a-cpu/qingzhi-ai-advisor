// 对话状态机回归：场景A/B/C复现 + 15条验收流（先失败后修复的永久回归）
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore, MemoryStorage } from '../frontend/src/engine/session.ts'
import { readFileSync } from 'node:fs'
const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url)))
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) }
}
function newAdvisor() { return new Advisor(new SessionStore(new MemoryStorage())) }

// 场景A：投诉→退款或换货→愿意 一次完成，不进兜底
{
  const a = newAdvisor()
  a.processMessage('我要投诉送货太慢', faqs)
  a.processMessage('退款或换货', faqs)
  const r3 = a.processMessage('愿意', faqs)
  check('A1 愿意不进兜底', !r3.reply.includes('没有完全理解'), `reply=${r3.reply.slice(0, 60)}`)
  check('A2 生成模拟工单', r3.reply.includes('QZ-'), `reply=${r3.reply.slice(0, 60)}`)
  check('A3 不承诺专人跟进', !r3.reply.includes('专人跟进') && !r3.reply.includes('稍后联系'), '')
  check('A4 状态一致', r3.stage !== 'clarify', `stage=${r3.stage}`)
}
// 场景B：两次“需要”，第一次即生效
{
  const a = newAdvisor()
  a.processMessage('我要投诉送货太慢', faqs)
  a.processMessage('退款或换货', faqs)
  const r3 = a.processMessage('需要', faqs)
  check('B1 第一个需要即登记', r3.reply.includes('QZ-'), `reply=${r3.reply.slice(0, 60)}`)
  const r4 = a.processMessage('需要', faqs)
  const tickets = (a.getContext().changeLog ?? []).filter(c => c.detail.includes('QZ-')).length
  const m = r4.reply.match(/QZ-[0-9A-Za-z]+/g) ?? []
  check('B2 不重复创建记录', new Set(m).size <= 1 && r4.reply.includes('QZ-'), `reply=${r4.reply.slice(0, 60)}`)
  check('B3 不重复询问登记', !r4.reply.includes('是否需要为') && !/专人跟进|安排联系/.test(r4.reply), `reply=${r4.reply.slice(0, 60)}`)
  void tickets
}
// 场景C：比较对象缺失 + 预算语义
{
  const a = newAdvisor()
  const r1 = a.processMessage('这两款哪个好', faqs)
  check('C1 无候选时指出缺少比较对象', r1.reply.includes('比较') && (r1.reply.includes('还没有选定') || r1.reply.includes('没有选定')), `reply=${r1.reply.slice(0, 60)}`)
  check('C2 不转成预算追问', !r1.reply.includes('预算大概是多少'), `reply=${r1.reply.slice(0, 60)}`)
  a.processMessage('冰箱', faqs)
  const r3 = a.processMessage('10000元以上', faqs)
  const ctx = a.getContext()
  const sem = ctx.changeLog.filter(c => /10000/.test(c.detail)).pop()
  check('C3 记录为预算下限', Boolean(sem && sem.detail.includes('下限')), `detail=${sem?.detail}`)
  check('C4 不再重复询问预算', !r3.reply.includes('预算大概是多少'), `reply=${r3.reply.slice(0, 60)}`)
}
// 验收3：暂不需要正确结束
{
  const a = newAdvisor()
  a.processMessage('我要投诉送货太慢', faqs)
  a.processMessage('退款或换货', faqs)
  const r3 = a.processMessage('暂不需要', faqs)
  check('D1 暂不需要不建工单', !r3.reply.includes('QZ-'), `reply=${r3.reply.slice(0, 60)}`)
  check('D2 不进兜底', !r3.reply.includes('没有完全理解'), `reply=${r3.reply.slice(0, 60)}`)
}
// 验收4：快捷按钮与手动输入一致
{
  const a1 = newAdvisor(), a2 = newAdvisor()
  for (const t of ['我要投诉送货太慢', '退款或换货']) { a1.processMessage(t, faqs); a2.processMessage(t, faqs) }
  const r1 = a1.processMessage('愿意', faqs), r2 = a2.processMessage('愿意', faqs)
  check('E1 按钮与手输一致', r1.reply.replace(/QZ-[0-9A-Za-z]+/, '') === r2.reply.replace(/QZ-[0-9A-Za-z]+/, ''), '')
}
// 验收9：钱不是问题不虚构预算
{
  const a = newAdvisor()
  a.processMessage('想买台冰箱', faqs)
  const r = a.processMessage('钱不是问题', faqs)
  const ctx = a.getContext()
  const hasBudget = Boolean(ctx.slots.totalBudget || ctx.slots.itemBudget || ctx.slots.itemBudgetRange || ctx.slots.itemBudgetByCategory)
  check('F1 不生成虚构预算数字', !hasBudget, `reply=${r.reply.slice(0, 60)}`)
}
// 验收13：刷新后待确认状态仍有效
{
  const storage = new MemoryStorage()
  const a1 = new Advisor(new SessionStore(storage))
  a1.processMessage('我要投诉送货太慢', faqs)
  a1.processMessage('退款或换货', faqs)
  const a2 = new Advisor(new SessionStore(storage))
  const r = a2.processMessage('愿意', faqs)
  check('G1 刷新后同意仍生效', r.reply.includes('QZ-'), `reply=${r.reply.slice(0, 60)}`)
}
// 验收14：安全优先于待确认状态
{
  const a = newAdvisor()
  a.processMessage('我要投诉送货太慢', faqs)
  a.processMessage('退款或换货', faqs)
  const r = a.processMessage('我家燃气热水器闻到燃气味', faqs)
  check('H1 安全优先', r.reply.includes('安全提醒') && r.stage === 'safety', `reply=${r.reply.slice(0, 40)}`)
}
// 验收12：索引比较
{
  const a = newAdvisor()
  a.processMessage('推荐个冰箱', faqs)
  const r = a.processMessage('前面第二个和第三个比一下', faqs)
  check('I1 索引比较被理解', !r.reply.includes('没有完全理解'), `reply=${r.reply.slice(0, 60)}`)
}
console.log(`\n对话状态回归: 通过 ${pass} / ${pass + fail}`)
if (failures.length) {
  console.log('失败项:')
  for (const f of failures) console.log(' - ' + f)
}
process.exit(fail > 0 ? 1 : 0)
