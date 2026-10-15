// 数据校验脚本：可重复运行；任一检查失败以退出码 1 结束并输出明细
// 运行: node scripts/validate-data.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')

const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'))

const errors = []
const add = (msg) => errors.push(msg)

const CATEGORIES = ['冰箱', '洗衣机', '空调', '热水器', '电视', '洗碗机']
const FICTIONAL_BRANDS = ['青澜', '岚汐', '海屿', '听澜', '屿光']
const REAL_BRAND_BLACKLIST = ['海尔', '美的', '格力', '海信', '西门子', '小天鹅', '松下', '三星', '博世', '方太', '老板电器', '史密斯', '小米', 'TCL', '创维', '卡萨帝', '容声', '美菱', '统帅', '奥克斯', '长虹', '康佳', '惠而浦', '东芝', '日立', '索尼', 'LG']
const INTENTS = ['pre_sales', 'comparison', 'after_sales', 'complaint', 'purchase_intent', 'chitchat']
// 统一六类意图枚举（评测集使用新版枚举）
const EVAL_INTENTS = ['pre_sale', 'comparison', 'after_sale', 'complaint', 'purchase_intent', 'chitchat_unknown']
const FAQ_CATEGORIES = ['售前选购', '产品参数', '配送', '安装', '使用方法', '保修', '退换', '维修', '清洗保养', '投诉建议']

// ---------- 商品校验 ----------
let products = []
try {
  products = readJson('products.json')
} catch (e) {
  add(`products.json 无法读取: ${e.message}`)
}

if (products.length > 0) {
  if (products.length < 120) add(`商品总数 ${products.length} < 120`)
  for (const cat of CATEGORIES) {
    const n = products.filter((p) => p.category === cat).length
    if (n < 20) add(`品类「${cat}」数量 ${n} < 20`)
  }
  const ids = new Set()
  for (const p of products) {
    const required = ['id', 'name', 'brand', 'category', 'price', 'priceBand', 'energyGrade', 'noiseDb', 'dimensionsMm', 'familySizeFit', 'stockStatus', 'afterSalesNote', 'tags', 'sellingPoints', 'limitations', 'dataSource']
    for (const f of required) {
      if (p[f] === undefined || p[f] === null || p[f] === '') add(`商品 ${p.id || '?'} 缺少必填字段 ${f}`)
    }
    if (ids.has(p.id)) add(`商品 ID 重复: ${p.id}`)
    ids.add(p.id)
    if (!Number.isInteger(p.price) || p.price < 500 || p.price > 30000) add(`商品 ${p.id} 价格无效: ${p.price}`)
    if (!FICTIONAL_BRANDS.some((b) => p.brand?.startsWith(b))) add(`商品 ${p.id} 品牌不在虚构品牌白名单: ${p.brand}`)
    const hay = `${p.name}|${p.brand}|${p.tags.join('|')}`
    for (const rb of REAL_BRAND_BLACKLIST) {
      if (hay.includes(rb)) add(`商品 ${p.id} 疑似混入真实品牌「${rb}」`)
    }
    if (p.dataSource && !p.dataSource.includes('模拟')) add(`商品 ${p.id} 数据来源标识异常: ${p.dataSource}`)
    const { standard, max } = p.noiseDb || {}
    if (!(standard >= 15 && standard <= 65)) add(`商品 ${p.id} 标准噪声异常: ${standard}`)
    if (!(max >= 15 && max <= 90) || (max !== undefined && standard !== undefined && max < standard)) add(`商品 ${p.id} 最大噪声异常: ${max}`)
    const d = p.dimensionsMm || {}
    for (const k of ['width', 'depth', 'height']) {
      if (!(d[k] >= 20 && d[k] <= 2600)) add(`商品 ${p.id} 尺寸字段 ${k} 异常: ${d[k]}`)
    }
    const fs = p.familySizeFit
    if (!Array.isArray(fs) || fs.length !== 2 || fs[0] < 1 || fs[1] > 8 || fs[0] > fs[1]) add(`商品 ${p.id} 适用家庭人数异常: ${JSON.stringify(fs)}`)
    if (p.suitableArea !== null && p.suitableArea !== undefined) {
      const [lo, hi] = p.suitableArea
      if (!(lo >= 2 && hi <= 100 && lo <= hi)) add(`商品 ${p.id} 适用面积异常: ${JSON.stringify(p.suitableArea)}`)
    }
    if (!(p.rating >= 3.5 && p.rating <= 5)) add(`商品 ${p.id} 评分异常: ${p.rating}`)
    // 品类专属字段
    switch (p.category) {
      case '冰箱':
        if (!(p.capacityL >= 50 && p.capacityL <= 800)) add(`商品 ${p.id} 冰箱容量异常: ${p.capacityL}`)
        if (!(p.freezerCapacityL >= 20 && p.freezerCapacityL <= 320)) add(`商品 ${p.id} 冷冻室容量异常: ${p.freezerCapacityL}`)
        break
      case '洗衣机':
        if (!(p.washCapacityKg >= 3 && p.washCapacityKg <= 16)) add(`商品 ${p.id} 洗涤容量异常: ${p.washCapacityKg}`)
        if (!(p.spinSpeedRpm >= 600 && p.spinSpeedRpm <= 1800)) add(`商品 ${p.id} 脱水转速异常: ${p.spinSpeedRpm}`)
        break
      case '空调':
        if (!(p.horsepower >= 0.5 && p.horsepower <= 5)) add(`商品 ${p.id} 匹数异常: ${p.horsepower}`)
        break
      case '热水器':
        if (!(p.literL >= 5 && p.literL <= 300)) add(`商品 ${p.id} 热水器升数异常: ${p.literL}`)
        if (!p.heatType) add(`商品 ${p.id} 缺少加热类型`)
        break
      case '电视':
        if (!(p.inchSize >= 20 && p.inchSize <= 120)) add(`商品 ${p.id} 电视尺寸异常: ${p.inchSize}`)
        if (!p.resolution) add(`商品 ${p.id} 缺少分辨率`)
        break
      case '洗碗机':
        if (!(p.placeSets >= 2 && p.placeSets <= 20)) add(`商品 ${p.id} 洗碗机套数异常: ${p.placeSets}`)
        if (!p.dryType) add(`商品 ${p.id} 缺少烘干方式`)
        break
    }
  }
}

// ---------- FAQ 校验 ----------
let faqs = []
try {
  faqs = readJson('faqs.json')
} catch (e) {
  add(`faqs.json 无法读取: ${e.message}`)
}

if (faqs.length > 0) {
  if (faqs.length < 60) add(`FAQ 数量 ${faqs.length} < 60`)
  for (const c of FAQ_CATEGORIES) {
    const n = faqs.filter((f) => f.category === c).length
    if (n === 0) add(`FAQ 缺少分类「${c}」`)
  }
  const ids = new Set()
  for (const f of faqs) {
    for (const k of ['id', 'category', 'applicableCategories', 'question', 'keywords', 'answer', 'sourceNote', 'safetyLevel']) {
      if (f[k] === undefined || f[k] === null || f[k] === '') add(`FAQ ${f.id || '?'} 缺少必填字段 ${k}`)
    }
    if (ids.has(f.id)) add(`FAQ ID 重复: ${f.id}`)
    ids.add(f.id)
    if (!f.answer || f.answer.trim().length < 10) add(`FAQ ${f.id} 答案为空或过短`)
    if (!Array.isArray(f.keywords) || f.keywords.length < 2) add(`FAQ ${f.id} 关键词不足 2 个`)
    if (!FAQ_CATEGORIES.includes(f.category)) add(`FAQ ${f.id} 分类非法: ${f.category}`)
    if (!['high', 'medium', 'low'].includes(f.safetyLevel)) add(`FAQ ${f.id} 安全级别非法: ${f.safetyLevel}`)
    if (f.safetyLevel === 'high') {
      const a = f.answer || ''
      if (!a.includes('停止使用') || !(a.includes('专业人员') || a.includes('专业维修') || a.includes('专业电工'))) {
        add(`FAQ ${f.id} 为高危安全问题，答案必须包含"停止使用"与专业人员指引: ${f.id}`)
      }
      if (a.includes('自行拆机') && !a.includes('不要自行拆机') && !a.includes('勿自行拆机')) {
        add(`FAQ ${f.id} 高危答案不得引导用户自行拆机`)
      }
    }
  }
}

// ---------- 测试对话校验 ----------
let dialogues = []
try {
  dialogues = readJson('test-dialogues.json')
} catch (e) {
  add(`test-dialogues.json 无法读取: ${e.message}`)
}

if (dialogues.length > 0) {
  if (dialogues.length < 24) add(`测试对话数量 ${dialogues.length} < 24`)
  const ids = new Set()
  const intentCount = {}
  for (const d of dialogues) {
    for (const k of ['id', 'scenario', 'intent', 'title', 'turns', 'dataSource']) {
      if (d[k] === undefined || d[k] === null || d[k] === '') add(`对话 ${d.id || '?'} 缺少必填字段 ${k}`)
    }
    if (ids.has(d.id)) add(`对话 ID 重复: ${d.id}`)
    ids.add(d.id)
    if (!INTENTS.includes(d.intent)) add(`对话 ${d.id} 意图非法: ${d.intent}`)
    intentCount[d.intent] = (intentCount[d.intent] || 0) + 1
    if (!Array.isArray(d.turns) || d.turns.length < 2) add(`对话 ${d.id} 轮次少于 2`)
    d.turns?.forEach((t, idx) => {
      if (t.seq !== idx + 1) add(`对话 ${d.id} 第 ${idx + 1} 轮 seq 不连续`)
      if (!t.user) add(`对话 ${d.id} 第 ${t.seq} 轮缺少用户输入`)
      if (t.expectIntent !== null && !INTENTS.includes(t.expectIntent)) add(`对话 ${d.id} 第 ${t.seq} 轮期望意图非法: ${t.expectIntent}`)
      if (typeof t.expectFollowup !== 'boolean') add(`对话 ${d.id} 第 ${t.seq} 轮缺少 expectFollowup 布尔值`)
      if (!t.expectPath) add(`对话 ${d.id} 第 ${t.seq} 轮缺少 expectPath`)
    })
  }
  for (const it of INTENTS) {
    if ((intentCount[it] || 0) < 4) add(`意图「${it}」测试对话数量 ${(intentCount[it] || 0)} < 4`)
  }
  // 主场景完整性
  const main = dialogues.find((d) => d.id === 'TD-PRE-01')
  if (!main) {
    add('缺少主演示场景对话 TD-PRE-01（青岛三口之家 8000 元组合购买）')
  } else {
    const t1 = main.turns?.[0] || {}
    const s = JSON.stringify(t1.expectSlots || {})
    for (const kw of ['8000', '冰箱', '洗衣机', 'seafoodStorage']) {
      if (!s.includes(kw) && !t1.user?.includes(kw)) add(`主场景 TD-PRE-01 首轮缺少关键要素「${kw}」`)
    }
  }
}

// ---------- 意图评测集校验 ----------
let evalItems = []
try {
  evalItems = readJson('intent-eval.json')
} catch (e) {
  add(`intent-eval.json 无法读取: ${e.message}`)
}
if (evalItems.length > 0) {
  if (evalItems.length < 72) add(`意图评测语句 ${evalItems.length} < 72`)
  const evalIntentCount = {}
  const difficultySet = new Set()
  const eids = new Set()
  for (const it of evalItems) {
    for (const k of ['id', 'expectedIntent', 'difficulty', 'text']) {
      if (!it[k]) add(`评测语句 ${it.id || '?'} 缺少字段 ${k}`)
    }
    if (eids.has(it.id)) add(`评测 ID 重复: ${it.id}`)
    eids.add(it.id)
    if (!EVAL_INTENTS.includes(it.expectedIntent)) add(`评测 ${it.id} 期望意图非法: ${it.expectedIntent}`)
    evalIntentCount[it.expectedIntent] = (evalIntentCount[it.expectedIntent] || 0) + 1
    difficultySet.add(it.difficulty)
  }
  for (const it of EVAL_INTENTS) {
    if ((evalIntentCount[it] || 0) < 12) add(`意图「${it}」评测语句 ${(evalIntentCount[it] || 0)} < 12`)
  }
  for (const d of ['common', 'colloquial', 'synonym', 'confusable', 'negation', 'incomplete']) {
    if (!difficultySet.has(d)) add(`评测集缺少表达类型「${d}」`)
  }
}

// ---------- 结果输出 ----------
console.log('========== 数据校验报告 ==========')
console.log(`商品 SKU: ${products.length} (要求 >=120，六品类各 >=20)`)
const catCount = {}
for (const cat of CATEGORIES) catCount[cat] = products.filter((p) => p.category === cat).length
console.log(`品类分布: ${JSON.stringify(catCount)}`)
console.log(`FAQ: ${faqs.length} 条 (要求 >=60)`)
console.log(`测试对话: ${dialogues.length} 组 (要求 >=24，六类各 >=4)`)

if (errors.length > 0) {
  console.error(`\n校验失败，共 ${errors.length} 项:`)
  for (const e of errors) console.error(`  [FAIL] ${e}`)
  process.exit(1)
} else {
  console.log('\n全部校验通过 ✓')
  process.exit(0)
}
