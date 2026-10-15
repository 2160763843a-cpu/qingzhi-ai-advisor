// 运行时冒烟：真实执行各页面 setup（Vue 客户端运行时 + 内存路由），捕获 TDZ/初始化错误
// 最小DOM存根：让 Element Plus 弹层组件在 Node 环境完成 setup（不模拟完整浏览器）
globalThis.document = globalThis.document ?? { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, remove() {}, addEventListener() {} }), body: { appendChild() {}, removeChild() {} } }
globalThis.window = globalThis.window ?? { addEventListener() {}, removeEventListener() {}, navigator: { userAgent: 'node-smoke' }, location: { href: 'http://localhost/' } }
try { globalThis.navigator = globalThis.navigator ?? { userAgent: 'node-smoke' } } catch { /* 只读则跳过 */ }

import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import ElementPlus from 'element-plus'
const server = await createServer({ root: new URL('../frontend', import.meta.url).pathname, plugins: [vue()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { default: App } = await server.ssrLoadModule('/src/App.vue')
const VIEWS = { '/': 'HomeView', '/chat': 'ChatView', '/products': 'ProductsView', '/compare': 'CompareView', '/kb': 'KbView', '/leads': 'LeadsView', '/dashboard': 'DashboardView', '/about': 'AboutView' }
const routes = []
for (const [p, v] of Object.entries(VIEWS)) {
  const m = await server.ssrLoadModule(`/src/views/${v}.vue`)
  routes.push({ path: p, component: m.default })
}
routes.push({ path: '/:pathMatch(.*)*', component: routes[0].component })
let fail = 0
for (const path of ['/', '/chat', '/products', '/compare', '/kb', '/leads', '/dashboard', '/about']) {
  const errs = []
  const app = createSSRApp({ render: () => h(App) })
  const router = createRouter({ history: createMemoryHistory(), routes })
  app.use(router)
  app.use(ElementPlus)
  const caught = []
  app.config.errorHandler = undefined
  const orig = app.config.warnHandler
  app.config.warnHandler = () => {}
  app.config.errorHandler = (e) => errs.push(String(e))
  router.push(path)
  let mounted = true
  try { await router.isReady(); await renderToString(app, () => {}) } catch (e) { mounted = false; errs.push(String(e).slice(0, 140)) }
  const ok = mounted && errs.length === 0
  console.log((ok ? 'PASS ' : 'FAIL ') + path + (ok ? '' : ' :: ' + errs.join(' | ')))
  if (!ok) fail++
}
await server.close()
console.log(fail === 0 ? '运行时冒烟: 8 路由 setup 全部执行成功' : `运行时冒烟: ${fail} 个路由失败`)
process.exit(fail > 0 ? 1 : 0)
