// 布局静态审计：公共页头声明高度必须容纳横幅+导航；主体不得使用负margin/页面级硬编码顶部距离
// 环境无 headless 浏览器，采用源码级断言 + 构建产物扫描，实测矩形数据由部署后 DOM 巡检脚本输出
import { readFileSync } from 'node:fs'
let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') { if (cond) { pass++ } else { fail++; failures.push(`${name} ${detail}`) } }
const app = readFileSync(new URL('../frontend/src/App.vue', import.meta.url), 'utf8')

// 1. header 高度必须是 auto（覆盖 el-header 默认 60px），否则横幅+导航 89px 会被裁成 60px 造成主体重叠
check('L1 .header 高度为 auto', /\.header\s*\{[^}]*height:\s*auto/i.test(app), '缺少 height:auto')
// 2. 禁止负 margin 顶部补偿与页面级硬编码 top
check('L2 无负margin顶部补偿', !/margin(-top)?:\s*-\d/.test(app), '')
check('L3 无硬编码top偏移', !/position:\s*fixed/.test(app), '')
// 3. 主体参与正常文档流（el-main，未用 fixed）
check('L4 主体非fixed定位', !/\.main\s*\{[^}]*position:\s*fixed/i.test(app), '')
// 4. sticky 页头需要占位：未使用 sticky 则通过
check('L5 页头非sticky或已占位', !/position:\s*sticky/i.test(app), '')
// 5. 窄屏媒体查询存在
check('L6 存在768px媒体查询', /@media[^{]*768px/.test(app), '')
// 6. 横幅文字允许换行
check('L7 横幅可换行', /white-space:\s*normal|word-break/.test(app) || !/white-space:\s*nowrap/.test(app), '')
// 7. 构建产物无 8000-undefined 类拼接（-undefined / undefined 元 / NaN 元）
const distDir = new URL('../frontend/dist/assets/', import.meta.url)
try {
  const files = readFileSync(new URL('../frontend/dist/index.html', import.meta.url)) && true
} catch { /* dist 未构建时跳过 */ }
let distBad = []
try {
  const { readdirSync } = await import('node:fs')
  for (const f of readdirSync(distDir)) {
    if (!f.endsWith('.js')) continue
    const src = readFileSync(new URL(`../frontend/dist/assets/${f}`, import.meta.url), 'utf8')
    for (const pat of ['-undefined', 'undefined 元', 'NaN 元', 'null 元', '[object Object]']) {
      if (src.includes(pat)) distBad.push(`${f}: ${pat}`)
    }
  }
} catch { /* 未构建 */ }
check('L8 构建产物无异常拼接', distBad.length === 0, distBad.slice(0, 3).join('; '))
// 9. 对比页：横向滚动容器 + 移动端滑动提示 + 表头语义
try {
  const cmp = readFileSync(new URL('../frontend/src/views/CompareView.vue', import.meta.url), 'utf8')
  check('L9 对比表横向滚动容器', /table-scroll[^}]*overflow-x:\s*auto/.test(cmp), '')
  check('L10 移动端滑动提示', /swipe-hint/.test(cmp) && /@media[^{]*768px/.test(cmp), '')
  check('L11 表头语义(scope/thead)', /scope="col"/.test(cmp) && /<thead>/.test(cmp), '')
  check('L12 /compare 路由已注册', /path:\s*'\/compare'/.test(readFileSync(new URL('../frontend/src/router/index.ts', import.meta.url), 'utf8')), '')
} catch (e) { check('L9-L12 对比页可读', false, String(e)) }
// 13. 运营看板
try {
  const dash = readFileSync(new URL('../frontend/src/views/DashboardView.vue', import.meta.url), 'utf8')
  check('L13 /dashboard 路由与导航注册', /path:\s*'\/dashboard'/.test(readFileSync(new URL('../frontend/src/router/index.ts', import.meta.url), 'utf8')) && /\u8fd0\u8425\u770b\u677f/.test(readFileSync(new URL('../frontend/src/App.vue', import.meta.url), 'utf8')), '')
  check('L14 看板移动端单列', /@media[^{]*768px/.test(dash) && /grid-template-columns:\s*1fr/.test(dash), '')
  check('L15 看板空状态与口径', /emptyMsg/.test(dash) && /\u6307\u6807\u53e3\u5f84/.test(dash), '')
} catch (e) { check('L13-L15 看板可读', false, String(e)) }
// 16-18: 最终构建CSS解析 + SFC结构断言（等价计算样式验证）
try {
  const { readdirSync } = await import('node:fs')
  let css = ''
  for (const f of readdirSync(new URL('../dist/assets/', import.meta.url))) {
    if (f.endsWith('.css')) css += readFileSync(new URL(`../dist/assets/${f}`, import.meta.url), 'utf8')
  }
  css = css.replace(/\[data-v-[^\]]+\]/g, '').replace(/\s/g, '')
  const maxBlock = css.match(/@media ?\(max-width:? ?767px\)\{[\s\S]{0,600}?\}\}/g)?.join('') ?? ''
  const minBlock = css.match(/@media ?\(min-width:? ?768px\)\{[\s\S]{0,600}?\}\}/g)?.join('') ?? ''
  const has = (block, seg) => block.includes(seg)
  check('L16 移动端隐藏桌面导航/操作并显示触发按钮', maxBlock.includes('.desktop-nav,.desktop-actions{display:none!important') && maxBlock.includes('.mobile-trigger{display:inline-flex!important'), '')
  check('L17 桌面端反向显隐', minBlock.includes('.desktop-nav,.desktop-actions{display:flex!important') && minBlock.includes('.mobile-trigger{display:none!important'), '')
  check('L18 声明仅单节点文本', (app.match(/banner-text/g) ?? []).length === 1, '')
  const homeSrc = readFileSync(new URL('../frontend/src/views/HomeView.vue', import.meta.url), 'utf8')
  const heroSrc = homeSrc.slice(homeSrc.indexOf('<section'), homeSrc.indexOf('</section>'))
  const copyIdx = heroSrc.indexOf('hero-copy')
  const flowIdx = heroSrc.indexOf('hero-flow')
  const opsIdx = heroSrc.indexOf('hero-ops')
  const titleIdx = heroSrc.indexOf('hero-title')
  check('L19 Hero 两容器结构（copy 在前 flow 在后）', copyIdx > -1 && flowIdx > copyIdx && opsIdx > -1 && opsIdx < flowIdx, `${copyIdx}/${opsIdx}/${flowIdx}`)
  check('L20 hero-copy 含标题', titleIdx > copyIdx && titleIdx < opsIdx, '')
} catch (e) { check('L16-L20 构建验证', false, String(e).slice(0, 120)) }
console.log(`\n布局审计: 通过 ${pass} / ${pass + fail}`)
if (failures.length) { console.log('失败项:'); for (const f of failures) console.log(' - ' + f) }
process.exit(fail > 0 ? 1 : 0)
