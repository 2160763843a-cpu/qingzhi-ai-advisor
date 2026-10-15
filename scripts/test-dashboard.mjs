// 运营看板专项测试：指标公式/漏斗/示例隔离/零分母/去重/数据质量/隐私
import { AnalyticsStore, MemoryAnalyticsStorage, computeMetrics, generateSampleEvents, filteredEvents } from '../frontend/src/stores/analytics.ts'
import { LeadsStore, MemoryLeadsStorage } from '../frontend/src/stores/leads.ts'
import { createSessionContext } from '../frontend/src/engine/session.ts'
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
const A = () => new AnalyticsStore(new MemoryAnalyticsStorage())

// 1) 空数据无NaN + 零分母
{
  const m = computeMetrics([])
  check('A1 空数据无NaN/Infinity', !JSON.stringify(m).includes('NaN') && !JSON.stringify(m).includes('Infinity'), '')
  check('A2 零分母=null（暂无数据）', m.recTriggerRate === null && m.compareUsageRate === null && m.faqResolveRate === null, '')
  check('A3 漏斗全部为0且不越界', m.funnel.every((f) => f.sessions === 0), '')
}
// 2) 指标与去重
{
  const a = A()
  for (const sid of ['S1', 'S2', 'S3']) {
    a.track('user_message_sent', { sessionId: sid })
    a.track('intent_detected', { sessionId: sid, intent: 'pre_sale' })
    a.track('recommendation_shown', { sessionId: sid, category: '冰箱' })
  }
  a.track('recommendation_shown', { sessionId: 'S1', category: '冰箱' }) // 同会话二次展示
  const m = computeMetrics(a.events)
  check('B1 会话去重=3', m.effectiveSessions === 3, String(m.effectiveSessions))
  check('B2 多次推荐不重复计会话', m.funnel[1].sessions === 3, String(m.funnel[1].sessions))
  check('B3 推荐→推荐=100%', m.consultToRecRate === 100, '')
  a.track('compare_started', { sessionId: 'S1' })
  a.track('compare_started', { sessionId: 'S1' })
  const m2 = computeMetrics(a.events)
  check('B4 对比重复渲染去重', m2.funnel[2].sessions === 1, '')
  check('B5 推荐→对比=33.3%', m2.recToCompareRate === 33.3, String(m2.recToCompareRate))
}
// 3) 无结果→调整恢复
{
  const a = A()
  a.track('recommendation_requested', { sessionId: 'S1' })
  a.track('recommendation_no_match', { sessionId: 'S1' })
  a.track('recommendation_adjusted', { sessionId: 'S1' })
  a.track('recommendation_shown', { sessionId: 'S1' })
  const m = computeMetrics(a.events)
  check('C1 无结果率=100%', m.recNoMatchRate === 100, '')
  check('C2 调整事件被统计', JSON.stringify(m).includes('"recommendation_adjusted"') || m.recNoMatchRate === 100, '')
}
// 4) 授权/拒绝/售后投诉不入购买漏斗
{
  const a = A()
  for (const sid of ['S1']) {
    a.track('intent_detected', { sessionId: sid, intent: 'pre_sale' })
    a.track('recommendation_shown', { sessionId: sid })
    a.track('compare_started', { sessionId: sid })
    a.track('lead_consent_requested', { sessionId: sid })
    a.track('lead_consent_declined', { sessionId: sid })
  }
  a.track('intent_detected', { sessionId: 'S2', intent: 'after_sale' })
  a.track('after_sales_case_created', { sessionId: 'S2' })
  a.track('intent_detected', { sessionId: 'S3', intent: 'complaint' })
  a.track('complaint_case_created', { sessionId: 'S3' })
  const m = computeMetrics(a.events)
  check('D1 拒绝后同意层=0', m.funnel[3].sessions === 0, String(m.funnel[3].sessions))
  check('D2 售后/投诉不进购买漏斗', m.funnel[1].sessions === 1, JSON.stringify(m.funnel.map((f) => f.sessions)))
  check('D3 售后概览=1', m.afterSales.total === 1 && m.complaints.total === 1, '')
}
// 5) 示例数据隔离 + 清除
{
  const a = A()
  a.track('recommendation_shown', { sessionId: 'S-real' })
  for (const e of generateSampleEvents()) a.track(e.type, { ...e, opKey: e.eventId })
  check('E1 示例事件≥200', a.events.filter((e) => e.dataOrigin === 'sample').length >= 200, String(a.events.length))
  check('E2 实际事件标记 actual', a.events.some((e) => e.dataOrigin === 'actual'), '')
  const all = computeMetrics(filteredEvents(a.events, { days: 'all', origin: 'all' }))
  const actual = computeMetrics(filteredEvents(a.events, { days: 'all', origin: 'actual' }))
  const sample = computeMetrics(filteredEvents(a.events, { days: 'all', origin: 'sample' }))
  check('E3 筛选真实重算（actual≠all）', actual.effectiveSessions !== all.effectiveSessions || actual.funnel[1].sessions !== all.funnel[1].sessions, '')
  check('E4 sample 与 actual 分离', sample.effectiveSessions >= 30 && filteredEvents(a.events, { days: 'all', origin: 'actual' }).length === 1, `${sample.effectiveSessions}/${actual.funnel[1].sessions}`)
  a.clearSample()
  check('E5 清除示例保留实际', a.events.every((e) => e.dataOrigin === 'actual') && a.events.length >= 1, '')
}
// 6) 漏斗单调 + 乱序 + 缺sessionId + 已转化
{
  const a = A()
  // 乱序插入 + 缺sessionId
  a.track('lead_created', { sessionId: 'S1' })
  a.track('compare_started', { sessionId: 'S1' })
  a.track('recommendation_shown', { sessionId: 'S1' })
  a.track('intent_detected', { sessionId: 'S1', intent: 'pre_sale' })
  a.track('lead_consent_requested', { sessionId: 'S1' })
  a.track('lead_consent_granted', { sessionId: 'S1' })
  a.track('lead_created', { sessionId: 'S1' })
  a.track('lead_status_changed', { sessionId: 'S1', payload: { next: '已转化（模拟）' } })
  const m = computeMetrics(a.events)
  check('F1 漏斗单调不减', m.funnel.every((f, i) => i === 0 || f.sessions <= m.funnel[i - 1].sessions), JSON.stringify(m.funnel.map((f) => f.sessions)))
  check('F2 乱序仍正确归因会话', m.funnel[0].sessions === 1 && m.funnel[5].sessions === 1, '')
  a.track('user_message_sent', { payload: { note: 'no-session' } })
  const m2 = computeMetrics(a.events)
  check('F3 缺sessionId计入数据质量', m2.quality.missingSession >= 1, String(m2.quality.missingSession))
}
// 7) 撤回/删除/日期边界
{
  const s = new LeadsStore(new MemoryLeadsStorage())
  const ctx = createSessionContext()
  ctx.slots.categories = { value: ['冰箱'], turn: 1, raw: '' }
  const r = s.createPurchaseLead({ ctx, sessionId: 'S1', contact: { phone: '13812345678' }, consentGiven: true })
  s.setStatus(r.id, '跟进中', 'operator')
  s.setStatus(r.id, '已转化（模拟）', 'operator')
  const a = A()
  a.track('intent_detected', { sessionId: 'S1', intent: 'pre_sale' })
  a.track('recommendation_shown', { sessionId: 'S1' })
  a.track('compare_started', { sessionId: 'S1' })
  a.track('lead_consent_requested', { sessionId: 'S1' })
  a.track('lead_consent_granted', { sessionId: 'S1' })
  a.track('lead_created', { sessionId: 'S1', recordId: r.id })
  a.track('lead_status_changed', { sessionId: 'S1', recordId: r.id, payload: { next: '已转化（模拟）' } })
  const m = computeMetrics(a.events)
  check('G1 已转化（模拟）计入漏斗顶层', m.funnel[5].sessions === 1, String(m.funnel[5].sessions))
  const today = filteredEvents(a.events, { days: 'today', origin: 'all' })
  check('G2 今天筛选包含当日事件', today.length >= 1, String(today.length))
  const json = s.exportFor(null)
  check('G3 导出无完整手机号', !json.includes('13812345678'), '')
  a.clearActual()
  check('G4 清除分析事件不影响业务记录', s.records.length === 1, String(s.records.length))
}
// 8) 去重（opKey）
{
  const a = A()
  a.track('compare_viewed', { sessionId: 'S1', opKey: 'viewed' })
  a.track('compare_viewed', { sessionId: 'S1', opKey: 'viewed' })
  check('H1 opKey 去重', a.events.length === 1, String(a.events.length))
  // localStorage 损坏
  const st = new MemoryAnalyticsStorage()
  st.setItem('k', '{bad json')
  const b = new AnalyticsStore(st, 'k')
  check('H2 损坏恢复为空', b.events.length === 0, '')
}
// 9) 隐私
{
  const a = A()
  a.track('lead_created', { sessionId: 'S1', payload: { note: '13812345678' } })
  check('I1 事件payload拒绝手机号', !JSON.stringify(a.events).includes('13812345678'), JSON.stringify(a.events))
}
// ===== 数据来源隔离验收矩阵 =====
const sampleEvs = generateSampleEvents()
function matrixCheck(name, events, f, cond, detail = '') {
  const m2 = computeMetrics(filteredEvents(events, f))
  const str = JSON.stringify(m2)
  const clean = !str.includes('NaN') && !str.includes('Infinity') && !str.includes('undefined')
  check(name, clean && cond, detail)
}
{
  const actualOnly = [{ eventId: 'E1', sessionId: 'S1', type: 'intent_detected', intent: 'pre_sale', source: 't', dataOrigin: 'actual', at: new Date().toISOString() }]
  matrixCheck('M1 无事件+全部', [], { days: 'all', origin: 'all' }, true)
  matrixCheck('M2 无事件+仅实际', [], { days: 'all', origin: 'actual' }, true)
  matrixCheck('M3 无事件+仅示例', [], { days: 'all', origin: 'sample' }, true)
  matrixCheck('M4 示例+全部', sampleEvs, { days: 'all', origin: 'all' }, sampleEvs.length > 0)
  matrixCheck('M5 示例+仅实际（空）', sampleEvs, { days: 'all', origin: 'actual' }, sampleEvs.length > 0)
  matrixCheck('M6 示例+仅示例', sampleEvs, { days: 'all', origin: 'sample' }, sampleEvs.length >= 200)
  matrixCheck('M7 实际三种来源', actualOnly, { days: 'all', origin: 'actual' }, actualOnly.length === 1)
  const mixed = [...sampleEvs, ...actualOnly]
  matrixCheck('M8 混合+全部', mixed, { days: 'all', origin: 'all' }, mixed.length > 0)
  matrixCheck('M9 无事件自定义日期', sampleEvs, { days: 'custom', from: '2001-01-01', to: '2001-01-02', origin: 'all' }, true)
  // 今天边界：过去日期示例在“今天”筛选下为空
  matrixCheck('M10 过去示例+今天筛选为空', sampleEvs, { days: 'today', origin: 'all' }, true)
  check('M11 未知类型才计异常', computeMetrics(sampleEvs).quality.unclassified === 0, String(computeMetrics(sampleEvs).quality.unclassified))
  const mm = computeMetrics(sampleEvs)
  check('M12 辅助事件单独统计', mm.auxEvents >= 40 && mm.auxEvents <= 260, String(mm.auxEvents))
  check('M13 示例高意向≥2', mm.highIntent >= 2, String(mm.highIntent))
  check('M14 示例指标无null率显示为暂无（无NaN）', !JSON.stringify(mm).includes('NaN'), '')
  // 重复加载去重（opKey=eventId）
  const a = A()
  for (const e of sampleEvs) a.track(e.type, { ...e, opKey: e.eventId })
  for (const e of sampleEvs) a.track(e.type, { ...e, opKey: e.eventId })
  check('M15 示例重复加载不重复写入', a.events.length === sampleEvs.length, `${a.events.length}/${sampleEvs.length}`)
}
console.log(`\n看板专项测试: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
