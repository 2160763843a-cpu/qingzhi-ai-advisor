<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchFaqs, fetchProducts, fetchTestDialogues } from '../api/client'
const ver = ref('')
const productCount = ref('-')
const faqCount = ref('-')
const dialogueCount = ref('-')
const loading = ref(false)
const loadError = ref(false)



async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [p, f, d] = await Promise.all([fetchProducts(), fetchFaqs(), fetchTestDialogues()])
    productCount.value = String(p.length)
    faqCount.value = String(f.length)
    dialogueCount.value = String(d.length)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const metrics = [
  { name: '意图识别准确率', target: '≥ 85%' },
  { name: '产品推荐命中率', target: '≥ 75%' },
  { name: '知识库问答准确率', target: '≥ 80%' },
  { name: '平均响应时间', target: '≤ 3 秒' },
  { name: '潜客线索识别率', target: '≥ 60%' },
  { name: '咨询到推荐转化率', target: '≥ 30%' }
]

const results = [
  { name: '意图识别评测（84 条）', result: '准确率 100%' },
  { name: '多轮上下文测试（24 组对话）', result: '1771 项断言全部通过' },
  { name: '推荐评测（50 组案例）', result: '命中率 100%，0 硬约束/预算违规' },
  { name: '安全风险评测（32 条）', result: '高风险召回 100%，误报 0' },
  { name: '知识库评测（94 条）', result: 'Top1 准确率 98.9%，Top3 100%' }
]

const loop = ['咨询', '需求识别', '商品推荐', '对比决策', '线索沉淀', '运营分析']
</script>

<template>
  <div>
    <el-alert
      type="warning"
      :closable="false"
      title="数据诚实性声明：本站全部商品、品牌、价格、FAQ、测试对话与经营数据均为模拟数据；所有指标仅基于模拟测试集测算，严禁作为真实线上经营结果"
      class="mark"
    />

    <el-card shadow="never" class="block">
      <template #header>数据规模  <p class="ver">演示版本 {{ ver }}（数据与指标详见上方说明；运行时无通用大模型接口）</p>
</template>
      <el-alert v-if="loadError" type="error" :closable="false" title="数据接口加载失败">
        <el-button size="small" type="primary" plain @click="load">重新加载</el-button>
      </el-alert>
      <div v-else-if="loading" v-loading="true" class="loading-block" />
      <el-descriptions v-else :column="3" border>
        <el-descriptions-item label="模拟商品 SKU">{{ productCount }} 款（六品类各 20 款）</el-descriptions-item>
        <el-descriptions-item label="知识库 FAQ">{{ faqCount }} 条（10 个分类）</el-descriptions-item>
        <el-descriptions-item label="多轮测试对话">{{ dialogueCount }} 组（六类意图各 4 组）</el-descriptions-item>
      </el-descriptions>
      <p class="note">数据由结构化模板批量生成并通过校验脚本检查（数量、ID 唯一性、必填字段、价格与规格区间、空答案、品牌合规）。</p>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>业务闭环</template>
      <el-steps :active="6" align-center>
        <el-step v-for="s in loop" :key="s" :title="s" />
      </el-steps>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>方向性指标（基于模拟测试集，用于开发验收与演示测算）</template>
      <el-table :data="metrics" border size="small">
        <el-table-column prop="name" label="指标" />
        <el-table-column prop="target" label="目标值" width="140" />
      </el-table>
      <el-table :data="results" border size="small" class="results">
        <el-table-column prop="name" label="评测项" />
        <el-table-column prop="result" label="当前版本实测（基于模拟测试集）" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>技术栈</template>
      <p class="note">
        前端：Vue 3 + TypeScript + Vite + Vue Router + Element Plus；
        后端：Node.js + Express（生产模式单进程单端口，托管前端构建产物）；
        对话与推荐能力：本地规则引擎，零密钥、零外部 API 依赖。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.mark {
  margin-bottom: 12px;
}
.block {
  margin-bottom: 12px;
}
.loading-block { min-height: 80px; }
.results { margin-bottom: 8px; }
.note {
  color: #7a8a99;
  font-size: 13px;
  line-height: 1.8;
}
.ver { color: #7A8A99; font-size: 12px; margin-top: 16px; }
</style>
