<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useRoleStore, type DemoRole, type ActorRole } from './stores/role'
const roleStore = useRoleStore()
import { ElMessage, ElMessageBox } from 'element-plus'

import { useRouter } from 'vue-router'
const router = useRouter()
async function resetDemoData() {
  try {
    await ElMessageBox.confirm('将清除当前浏览器中的演示会话、对比列表、线索/售后/投诉记录、分析事件与角色选择（公共商品与FAQ不受影响），并返回首页。此操作不可恢复。', '重置演示数据', { confirmButtonText: '确认重置', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  const keys = ['qzad.session.v1', 'qzad.compare.v1', 'qzad.leads.v1', 'qzad.audit.v1', 'qzad.analytics.v1', 'qzad.role.v1']
  for (const k of keys) { try { globalThis.localStorage.removeItem(k) } catch { /* 忽略 */ } }
  ElMessage.success('演示数据已重置（仅当前浏览器）')
  router.push('/')
  setTimeout(() => globalThis.location.reload(), 300)
}

const route = useRoute()
const mobileMenu = ref(false)
watch(() => route.path, () => { mobileMenu.value = false })
const role = computed(() => roleStore.state.current)
function onRoleChange(v: ActorRole) {
  roleStore.setRole(v as DemoRole)
  ElMessage.success(v === 'operator' ? '已切换至运营视角，可查看全部模拟线索和运营看板。' : '已切换至消费者视角。')
}
const NAV_ITEMS = [
  { to: '/', label: '首页' },
  { to: '/chat', label: '智能顾问' },
  { to: '/products', label: '商品库' },
  { to: '/compare', label: '商品对比' },
  { to: '/kb', label: '服务中心' },
  { to: '/about', label: '数据与说明' },
  { to: '/leads', label: '线索管理' },
  { to: '/dashboard', label: '运营看板' }
]
</script>

<template>
  <el-container class="layout">
    <el-header class="header">
      <div class="banner">
        <span class="sim-badge">模拟演示</span>
        <span class="banner-text">商品、价格、用户与经营数据均为模拟；线索仅保存在当前浏览器。</span>
        <router-link class="banner-link" to="/about">数据说明</router-link>
      </div>
      <div class="nav-row header-main">
        <div class="brand">
          <span class="brand-name">青智家 AI 顾问</span>
          <span class="brand-sub">智能客服与营销转化平台（演示版）</span>
        </div>
        <nav class="desktop-nav nav-menu" aria-label="全站导航">
          <RouterLink to="/" class="nav-link" :class="{ active: route.path === '/' }" :aria-current="route.path === '/' ? 'page' : undefined">首页</RouterLink>
          <RouterLink to="/chat" class="nav-link" :class="{ active: route.path === '/chat' }" :aria-current="route.path === '/chat' ? 'page' : undefined">智能顾问</RouterLink>
          <RouterLink to="/products" class="nav-link" :class="{ active: route.path === '/products' }" :aria-current="route.path === '/products' ? 'page' : undefined">商品库</RouterLink>
          <RouterLink to="/compare" class="nav-link" :class="{ active: route.path === '/compare' }" :aria-current="route.path === '/compare' ? 'page' : undefined">商品对比</RouterLink>
          <RouterLink to="/kb" class="nav-link" :class="{ active: route.path === '/kb' }" :aria-current="route.path === '/kb' ? 'page' : undefined">服务中心</RouterLink>
          <el-dropdown trigger="click" teleported>
            <span class="nav-link dd" :class="{ active: ['/leads','/dashboard'].includes(route.path) }" role="button" tabindex="0" :aria-current="['/leads','/dashboard'].includes(route.path) ? 'page' : undefined" @click.prevent @keydown.enter.prevent="mobileMenu = true">运营中心 ▾</span>
            <template #dropdown>
              <el-dropdown-item><RouterLink to="/leads" class="dd-link">线索管理</RouterLink></el-dropdown-item>
              <el-dropdown-item><RouterLink to="/dashboard" class="dd-link">运营看板</RouterLink></el-dropdown-item>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click" teleported>
            <span class="nav-link dd" role="button" tabindex="0" @click.prevent>更多 ▾</span>
            <template #dropdown>
              <el-dropdown-item><RouterLink to="/about" class="dd-link">数据与说明</RouterLink></el-dropdown-item>
              <el-dropdown-item divided @click="resetDemoData">重置演示数据</el-dropdown-item>
            </template>
          </el-dropdown>
        </nav>
        <div class="desktop-actions head-right">
          <el-radio-group :model-value="role" size="small" class="role-group" @update:model-value="onRoleChange($event as ActorRole)">
            <el-radio-button value="consumer">消费者视角</el-radio-button>
            <el-radio-button value="operator">运营视角</el-radio-button>
          </el-radio-group>
          <span class="role-note">当前：{{ role === 'operator' ? '运营视角' : '消费者视角' }}（演示）</span>
          <el-dropdown trigger="click">
            <el-button size="small" text aria-label="演示设置">更多 ▾</el-button>
            <template #dropdown>
              <el-dropdown-item @click="resetDemoData">重置演示数据</el-dropdown-item>
            </template>
          </el-dropdown>
        </div>
        <button class="mobile-trigger" aria-label="打开导航菜单" :aria-expanded="mobileMenu" @click="mobileMenu = true">☰ 菜单</button>
      </div>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
    <el-footer class="footer">
      咨询 — 需求识别 — 商品推荐 — 对比决策 — 线索沉淀 — 运营分析
      <br />
      AI 智能客服与营销转化应用 · 赛题演示项目
    </el-footer>
  </el-container>

<el-drawer v-model="mobileMenu" title="导航菜单" size="78%" direction="ltr">
  <nav class="m-nav" aria-label="移动端导航">
    <RouterLink v-for="item in NAV_ITEMS" :key="item.to" :to="item.to" class="m-link" :class="{ active: route.path === item.to }">{{ item.label }}</RouterLink>
  </nav>
  <div class="m-role">
    <span class="role-note">演示角色（非真实登录）</span>
    <el-radio-group :model-value="role" size="small" @update:model-value="onRoleChange($event as ActorRole)">
      <el-radio-button value="consumer">消费者视角</el-radio-button>
      <el-radio-button value="operator">运营视角</el-radio-button>
    </el-radio-group>
    <el-button size="small" type="warning" plain @click="mobileMenu = false; resetDemoData()">重置演示数据</el-button>
  </div>
</el-drawer>
</template>

<style scoped>
.layout {
  min-height: 100vh;
  background: #f4f7f9;
}
.header {
  /* el-header 默认 60px 会裁掉“横幅+导航”的完整高度，导致主体与导航重叠 */
  height: auto !important;
  padding: 0;
  background: #fff;
  border-bottom: 1px solid #e6ebf0;
}
.banner {
  background: #fff7e6;
  color: #8a5a00;
  text-align: center;
  padding: 6px 12px;
  font-size: 13px;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}
.nav-row {
  max-width: 1240px;
  margin: 0 auto;
  padding: 0 16px;
}
.header-main {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) auto;
  align-items: center;
}
.brand { grid-column: 1; grid-row: 1; }
.desktop-nav { grid-column: 2; grid-row: 1; }
.desktop-actions { grid-column: 3; grid-row: 1; }
.banner { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.banner-link { color: #8a5a00; text-decoration: underline; font-size: 12px; }
.desktop-nav { display: flex; flex-wrap: nowrap; align-items: center; gap: 2px; min-width: 0; justify-self: center; }
.nav-link { padding: 18px 11px; white-space: nowrap; }
.dd { cursor: pointer; user-select: none; }
.dd-link { display: block; width: 100%; color: #33475B; text-decoration: none; }
.desktop-actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.role-note { font-size: 12px; color: #7A8A99; white-space: nowrap; }
.mobile-trigger { display: none; }
@media (max-width: 767px) {
  .desktop-nav { display: none !important; }
  .desktop-actions { display: none !important; }
  .mobile-trigger { display: inline-flex !important; align-items: center; }
  .header-main { grid-template-columns: minmax(0, 1fr) auto; }
  .brand { grid-column: 1; grid-row: 1; }
  .mobile-trigger { grid-column: 2; grid-row: 1; width: auto; justify-self: end; }
}
@media (min-width: 768px) {
  .desktop-nav { display: flex !important; }
  .desktop-actions { display: flex !important; }
  .mobile-trigger { display: none !important; }
}
@media (max-width: 767px) {
  .hero-side-flow { flex-direction: row; flex-wrap: wrap; gap: 10px; }
}
.m-nav { display: flex; flex-direction: column; }
.m-link { padding: 12px 8px; color: #33475B; text-decoration: none; border-bottom: 1px solid #EEF2F6; }
.m-link.active { color: #087F8C; font-weight: 700; }
.m-role { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
</style>
