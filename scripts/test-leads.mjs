// 线索沉淀与线索管理专项测试：评分/授权/脱敏/状态流转/撤回删除/审计/50组评测
import { LeadsStore, MemoryLeadsStorage } from '../frontend/src/stores/leads.ts'
import { WEIGHTS_TOTAL, scorePurchaseLead, detectPurchaseIntent, maskPhone } from '../frontend/src/engine/leadScore.ts'
import { createSessionContext } from '../frontend/src/engine/session.ts'
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
function mkCtx(fn) { const ctx = createSessionContext(); if (fn) fn(ctx); return ctx }
const setSlot = (ctx, k, v) => { ctx.slots[k] = { value: v, turn: 1, raw: '' } }

check('W1 评分权重总和=100', WEIGHTS_TOTAL === 100, String(WEIGHTS_TOTAL))
{
  const s = new LeadsStore(new MemoryLeadsStorage())
  const ctx = mkCtx((c) => { setSlot(c, 'categories', ['冰箱']); setSlot(c, 'totalBudget', 5000); setSlot(c, 'purchaseTime', '这周内'); c.recommendations = { cards: { 冰箱: [{ productId: 'RF-01' }] }, candidates: ['RF-01'] } })
  const r = s.createPurchaseLead({ ctx, sessionId: 'S1', contact: { phone: '13812345678' }, consentGiven: true })
  check('W2 高意向≥70', r.intentScore >= 70 && r.intentLevel === '高', `${r.intentScore}`)
  check('W3 得分依据可解释', (r.scoreItems?.length ?? 0) >= 3, JSON.stringify(r.scoreItems))
  check('W4 脱敏显示', maskPhone('13812345678') === '138****5678', maskPhone('13812345678'))
  check('W5 导出不含完整号码', !s.exportFor('S1').includes('13812345678'), '')
  check('W6 导出含模拟声明', s.exportFor('S1').includes('模拟数据声明'), '')
  const score = s.scoreOf(mkCtx(), {})
  check('W7 空会话低意向', score.total === 0 && score.level === '低', '')
  // 拒绝联系不能判成同意
  const declined = s.scoreOf(mkCtx(), { explicitBuy: true, consentGiven: false })
  check('W8 拒绝时不加同意分', declined.items.every((i) => i.key !== 'consentGiven'), '')
  // 售后/投诉使用服务优先级
  const svc = s.createAfterSalesCase({ sessionId: 'S1', category: '空调', faults: ['不制冷'], tried: true, resolved: false, expectation: '上门检测' })
  check('W9 售后记录无意向分', svc.intentScore === undefined && svc.priority === '中', JSON.stringify({ p: svc.priority, i: svc.intentScore }))
  const cpl = s.createComplaintCase({ sessionId: 'S1', topic: '送货太慢', detail: '十天未送达', expectation: '退款或换货', contactConsent: true })
  check('W10 投诉记录服务优先级', cpl.priority === '高' && cpl.intentScore === undefined, '')
}
// 授权状态机：无待授权时短回答不采集
{
  check('A1 无待授权时“愿意”不算购买', detectPurchaseIntent('愿意', false) === null, '')
  check('A2 待授权时“愿意”=同意', detectPurchaseIntent('愿意', true) === 'buy', '')
  check('A3 拒绝表达', detectPurchaseIntent('我再看看，先别联系我', false) === 'decline', '')
  check('A4 撤回表达', detectPurchaseIntent('不要联系我了', false) === 'cancel', '')
  check('A5 明确购买', detectPurchaseIntent('第一套不错，我准备这周买', false) === 'buy', '')
  check('A6 询问现货', detectPurchaseIntent('这款有现货吗', false) === 'buy', '')
  check('A7 闲聊不误判', detectPurchaseIntent('今天天气不错', false) === null, '')
}
// 状态流转
{
  const s = new LeadsStore(new MemoryLeadsStorage())
  const ctx = mkCtx((c) => setSlot(c, 'categories', ['冰箱']))
  const r = s.createPurchaseLead({ ctx, sessionId: 'S1', contact: { phone: '13900001111' }, consentGiven: true })
  check('T1 初始状态=新建', r.status === '新建', r.status)
  check('T2 合法流转', s.setStatus(r.id, '跟进中', 'operator').ok, '')
  check('T3 非法流转被拒绝并解释', !s.setStatus(r.id, '新建', 'operator').ok && s.setStatus(r.id, '待确认', 'operator').reason, '')
  check('T4 状态修改进入审计', s.audit.some((a) => a.action === 'lead_status_changed'), '')
}
// 撤回与删除
{
  const s = new LeadsStore(new MemoryLeadsStorage())
  const ctx = mkCtx((c) => setSlot(c, 'categories', ['冰箱']))
  const r = s.createPurchaseLead({ ctx, sessionId: 'S1', contact: { phone: '13812345678' }, consentGiven: true })
  check('Z1 撤回前可查看完整', s.viewSensitiveContact(r.id, 'operator') === '13812345678', '')
  s.withdrawConsent(r.id, 'consumer')
  check('Z2 撤回后完整号码不可见', s.viewSensitiveContact(r.id, 'operator') === null, '')
  check('Z3 撤回审计', s.audit.some((a) => a.action === 'consent_withdrawn'), '')
  const size = s.records.length
  s.remove(r.id, 'consumer')
  check('Z4 删除生效且审计', s.records.length === size - 1 && s.audit.some((a) => a.action === 'lead_deleted'), '')
}
// 敏感信息不入日志
{
  const s = new LeadsStore(new MemoryLeadsStorage())
  const ctx = mkCtx((c) => setSlot(c, 'categories', ['冰箱']))
  s.createPurchaseLead({ ctx, sessionId: 'S1', contact: { phone: '13812345678' }, consentGiven: true })
  const auditStr = JSON.stringify(s.audit)
  check('P1 审计日志无完整手机号', !auditStr.includes('13812345678'), '')
}
// ===== 50组独立评测 =====
const EVAL = [
  ['我想买第一款', 'high'], ['就选这个', 'high'], ['帮我下单', 'high'], ['最近就要买', 'high'],
  ['想预约了解一下', 'high'], ['能安排人联系我吗', 'high'], ['我准备这周购买', 'high'], ['这款有现货吗', 'high'],
  ['可以安排安装吗', 'high'], ['第一套不错，我准备这周买', 'high'], ['就它了，什么时候能送', 'high'], ['决定买了，帮我走流程', 'high'],
  ['这台不错就选这台', 'high'], ['帮我登记购买意向', 'high'], ['现在下单有优惠吗', 'high'], ['我要买两台，明天能送到吗', 'high'],
  ['我再看看', 'mid'], ['先比较一下', 'mid'], ['还没决定', 'mid'], ['过几个月再说', 'mid'],
  ['先了解一下行情', 'mid'], ['有没有大容量款推荐', 'mid'], ['预算五千有什么选择', 'mid'], ['静音效果好一点的有哪些', 'mid'],
  ['四口人用多大的冰箱', 'mid'], ['我随便看看', 'low'], ['今天天气不错', 'low'], ['你好呀', 'low'],
  ['讲个笑话吧', 'low'], ['你们几点下班', 'low'], ['这个品牌是哪里的', 'low'], ['青岛有什么好玩的', 'low'],
  ['冰箱有什么种类', 'low'], ['谢谢', 'low'], ['再见', 'low'], ['帮我推荐个电影', 'low'],
  ['我再看看，先别联系我', 'decline'], ['先别联系我', 'decline'], ['暂时不买，别联系了', 'decline'], ['不要联系我了', 'decline_cancel'],
  ['取消登记', 'decline_cancel'], ['删除我的信息', 'decline_cancel'], ['我不同意继续保存', 'decline_cancel'], ['刚才点错了', 'decline_cancel'],
  ['先不用了，我再考虑一下', 'decline'], ['暂不需要联系', 'decline'], ['不着急，先放着', 'decline'], ['我只是随便看看，不用找我', 'decline'],
  ['空调用了三年不制冷', 'protect_service'], ['我要投诉送货太慢', 'protect_service'], ['洗衣机脱水声音很大怎么修', 'protect_service'], ['冰箱漏水了，你们售后怎么处理', 'protect_service'],
  ['投诉你们安装总不来', 'protect_service'], ['热水器打不着火，报修一下', 'protect_service'], ['电视花屏了要求换货', 'protect_service'], ['冰箱有异味怎么处理', 'protect_service']
]
let highHit = 0, highTotal = 0, leadHit = 0, leadTotal = 0, predLead = 0, declineMiscollect = 0, serviceMislead = 0, tp = 0, fp = 0, fn = 0
const fails = []
for (const [text, label] of EVAL) {
  const pendingConsent = false
  const kind = detectPurchaseIntent(text, pendingConsent)
  const isLeadLabel = label === 'high' || label === 'mid'
  const detectedLead = kind === 'buy' || kind === 'considering'
  if (label === 'high') { highTotal++; if (detectedLead) highHit++; }
  if (isLeadLabel) { leadTotal++; if (detectedLead) { leadHit++; tp++ } else { fn++; fails.push(`漏判[${label}] ${text}`) } }
  else {
    if (detectedLead) {
      fp++
      if (label.startsWith('decline')) declineMiscollect++
      if (label === 'protect_service') serviceMislead++
      fails.push(`误判[${label}] ${text}`)
    }
  }
  if (detectedLead) predLead++
}
const precision = predLead ? Math.round((tp / predLead) * 1000) / 10 : 0
const recall = leadTotal ? Math.round((tp / leadTotal) * 1000) / 10 : 0
const f1 = precision + recall ? Math.round((2 * precision * recall) / (precision + recall) * 10) / 10 : 0
const highAcc = Math.round((highHit / highTotal) * 1000) / 10
const leadRate = Math.round((leadHit / leadTotal) * 1000) / 10
console.log(`\n线索识别评测（${EVAL.length}组）: 高意向识别 ${highHit}/${highTotal}=${highAcc}% ｜ 潜客识别率 ${leadHit}/${leadTotal}=${leadRate}% ｜ 精确率 ${precision}% ｜ 召回率 ${recall}% ｜ F1 ${f1}`)
console.log(`拒绝联系误采集: ${declineMiscollect}（目标0）｜ 售后/投诉误判购买: ${serviceMislead}（目标0）`)
if (fails.length) { console.log('失败样例:'); for (const f of fails) console.log(' - ' + f) }
check('E1 潜客识别率≥60%', leadRate >= 60, String(leadRate))
check('E2 拒绝联系误采集=0', declineMiscollect === 0, '')
check('E3 售后/投诉误判购买=0', serviceMislead === 0, '')
check('E4 评测规模≥50', EVAL.length >= 50, String(EVAL.length))
console.log(`\n线索专项测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
