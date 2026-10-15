<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchFaqs, fetchProducts, fetchTestDialogues } from '../api/client'

const productCount = ref<number | null>(null)
const faqCount = ref<number | null>(null)
const dialogueCount = ref<number | null>(null)
const serviceReady = ref(false)
const FLOW = ['咨询', '需求识别', '商品推荐', '对比决策', '线索沉淀', '运营分析']

onMounted(async () => {
  try {
    const [p, f, d] = await Promise.all([fetchProducts(), fetchFaqs(), fetchTestDialogues()])
    productCount.value = p.length
    faqCount.value = f.length
    dialogueCount.value = d.length
    serviceReady.value = true
  } catch {
    serviceReady.value = false
  }
})
</script>

<template>
  <section class="hero card">
    <div class="hero-copy">
    <span class="scene-tag">青岛智慧家电消费场景 · 赛题演示</span>
    <h1 class="hero-title">让客服不止回答问题，更能推动购买决策</h1>
    <p class="hero-sub">从需求识别、可解释推荐与对比，到合规线索沉淀与运营分析，一个平台完成消费转化闭环。</p>
      <div class="hero-ops">
        <el-button type="primary" size="large" tag="router-link" to="/chat">开始智能咨询</el-button>
        <el-button size="large" tag="router-link" to="/dashboard">查看运营闭环</el-button>
      </div>
    </div>
    <div class="hero-flow hero-side-flow">
    <div class="flow-side" aria-label="六阶段闭环">
      <div v-for="(f, i) in FLOW" :key="f" class="flow-node">
        <span class="dot" /><span class="flow-word">{{ f }}</span>
        <span v-if="i < FLOW.length - 1" class="vline" />
      </div>
    </div>
    </div>
  </section>
  <div class="home">
    <el-row :gutter="16" class="cards">
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="hover">
          <div class="stat-num">{{ productCount ?? '-' }}</div>
          <div class="stat-label">模拟商品 SKU（六品类）</div>
          <el-button size="small" type="primary" plain @click="$router.push('/products')">进入商品库</el-button>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="hover">
          <div class="stat-num">{{ faqCount ?? '-' }}</div>
          <div class="stat-label">知识库 FAQ 条目</div>
          <el-button size="small" type="primary" plain @click="$router.push('/about')">查看说明</el-button>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="8">
        <el-card shadow="hover">
          <div class="stat-num">{{ dialogueCount ?? '-' }}</div>
          <div class="stat-label">多轮测试对话（模拟测试集）</div>
          <el-button size="small" type="primary" plain @click="$router.push('/about')">查看说明</el-button>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="roles">
      <template #header>模拟角色入口（演示版）</template>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-card shadow="hover" class="role-card">
            <div class="role-title">消费者演示</div>
            <div class="role-desc">体验售前咨询、商品比较、售后与投诉流程，线索生成前将征得您的同意</div>
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="hover" class="role-card">
            <div class="role-title">运营人员演示</div>
            <div class="role-desc">查看脱敏后的模拟线索列表与转化漏斗，敏感操作需二次确认并记录审计日志</div>
          </el-card>
        </el-col>
      </el-row>
    </el-card>

    <el-alert v-if="!serviceReady" type="error" :closable="false" title="数据接口异常，请稍后刷新或查看 /about 说明" class="status" />
  </div>
</template>

<style scoped>
.hero-title {
  margin: 0 0 8px;
  color: #0b6e6e;
}
.hero-text {
  color: #4a5a68;
  line-height: 1.8;
  margin: 0 0 12px;
}
.quick {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.entry {
  margin-top: 14px;
}
.cards {
  margin-top: 16px;
}
.stat-num {
  font-size: 30px;
  font-weight: 700;
  color: #0b6e6e;
}
.stat-label {
  color: #7a8a99;
  font-size: 13px;
  margin: 4px 0 12px;
}
.roles {
  margin-top: 16px;
}
.role-card {
  cursor: default;
}
.role-title {
  font-weight: 600;
  color: #1f2d3d;
}
.role-desc {
  color: #7a8a99;
  font-size: 13px;
  margin-top: 6px;
  line-height: 1.6;
}
.status {
  margin-top: 16px;
}
</style>
<style scoped>
.hero { padding: 28px; margin-bottom: 16px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: center; }
.hero-copy { min-width: 0; }
.hero-flow { justify-self: end; }
@media (max-width: 767px) { .hero { grid-template-columns: 1fr; } .hero-flow { justify-self: start; } }
.flow-side { display: flex; flex-direction: column; gap: 2px; min-width: 150px; }
.flow-node { display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #087F8C; flex-shrink: 0; }
.flow-word { font-size: 13px; color: #44576B; white-space: nowrap; }
.vline { width: 2px; height: 14px; background: #D8E6EC; margin-left: 4px; }
@media (max-width: 768px) { .flow-side { flex-direction: row; flex-wrap: wrap; gap: 10px; } .vline { display: none; } }
.scene-tag { display: inline-block; background: #E6F4F5; color: var(--brand-strong, #066A75); font-size: 13px; border-radius: 6px; padding: 2px 10px; margin-bottom: 10px; }
.hero-title { font-size: 26px; margin: 0 0 8px; color: #1F2D3D; }
.hero-sub { color: #44576B; margin: 0 0 16px; max-width: 640px; line-height: 1.7; }
.hero-ops { display: flex; gap: 12px; margin-bottom: 18px; }
.flow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #44576B; }
.flow-step { background: #F0F7FA; border: 1px solid #DCEAF0; border-radius: 999px; padding: 3px 12px; }
.flow-arrow { color: #7A8A99; margin-left: 6px; font-style: normal; }
</style>
