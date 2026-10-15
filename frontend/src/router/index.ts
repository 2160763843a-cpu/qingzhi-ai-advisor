import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/chat', name: 'chat', component: () => import('../views/ChatView.vue') },
    { path: '/products', name: 'products', component: () => import('../views/ProductsView.vue') },
    { path: '/compare', name: 'compare', component: () => import('../views/CompareView.vue') },
    { path: '/leads', name: 'leads', component: () => import('../views/LeadsView.vue') },
    { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/kb', name: 'kb', component: () => import('../views/KbView.vue') },
    { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') }
  ]
})

export default router
