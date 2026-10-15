// 用户可见异常值扫描：源码模板拼接风险 + 引擎运行时输出
import { Advisor } from '../frontend/src/engine/engine.ts'
import { SessionStore, MemoryStorage } from '../frontend/src/engine/session.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
let fail = 0
const problems = []
const BAD = ['undefined', 'NaN', '[object Object]', 'Infinity', '-null', 'null 元', '-undefined']
// 1) 引擎运行时输出
const faqs = JSON.parse(readFileSync(new URL('../data/faqs.json', import.meta.url)))
const a = new Advisor(new SessionStore(new MemoryStorage()))
const utterances = ['想买冰箱', '8000元以上', '5人以上', '性价比高', '两件总共8000元', '一万多', '钱不是问题', '预算没有上限', '大概8000元', '最多8000元', '厨房宽700深650', '老人用简单一点', '保修期多久', '空调用了三年不制冷', '我要投诉送货太慢', '退款或换货', '愿意', '这两款哪个好', '冰箱怎么清洗', '厨房怎么布置好']
for (const t of utterances) {
  const r = a.processMessage(t, faqs)
  for (const b of BAD) {
    if ((r.reply ?? '').includes(b)) problems.push(`reply[${t}] 含 ${b}`)
    for (const c of r.slotChanges ?? []) if ((c.detail ?? '').includes(b)) problems.push(`slotChange[${t}] 含 ${b}`)
  }
}
const rec = a.generateRecommendations ? undefined : undefined
// 2) 源码模板风险拼接：用户可见字符串中的 ${...}-${...} 且以 元 结尾
try {
  const out = execSync("grep -rn -- '-\\${' frontend/src/views frontend/src/engine | grep '元' || true", { encoding: 'utf8' })
  for (const line of out.split('\n').filter(Boolean)) problems.push(`模板拼接风险: ${line}`)
} catch { /* grep 无匹配 */ }
console.log(problems.length ? `异常值扫描失败（${problems.length}）:\n` + problems.map(p => ' - ' + p).join('\n') : '用户可见异常值扫描: 通过')
process.exit(problems.length > 0 ? 1 : 0)
