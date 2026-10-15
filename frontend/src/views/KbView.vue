<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fetchFaqs } from '../api/client'
import type { Category, Faq, FaqCategory } from '../types/data'
import { CATEGORIES } from '../types/data'

const loading = ref(true)
const error = ref(false)
const all = ref<Faq[]>([])
const keyword = ref('')
const category = ref<Category | ''>('')
const faqCategory = ref<FaqCategory | ''>('')
const openIds = ref<string[]>([])

const FAQ_TYPES: FaqCategory[] = ['售前选购', '产品参数', '配送', '安装', '使用方法', '保修', '退换', '维修', '清洗保养', '投诉建议']

async function load() {
  loading.value = true
  error.value = false
  try {
    all.value = await fetchFaqs()
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() =>
  all.value.filter((f) => {
    if (faqCategory.value && f.category !== faqCategory.value) return false
    if (category.value && !f.applicableCategories.includes(category.value) && !f.applicableCategories.includes('全品类')) return false
    const kw = keyword.value.trim().toLowerCase()
    if (kw) {
      const hay = `${f.question} ${f.keywords.join(' ')} ${f.answer}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
)

function resetFilters() {
  keyword.value = ''
  category.value = ''
  faqCategory.value = ''
  openIds.value = []
}

const SAFETY_TEXT: Record<string, string> = { high: '安全风险（请优先按指引处理）', medium: '需注意安全', low: '常规' }
</script>

<template>
  <div>
    <el-alert
      type="warning"
      :closable="false"
      title="模拟知识库声明：以下全部条目为模拟数据，仅供赛题演示；安全类条目请以官方指引与专业人员意见为准"
      class="mark"
    />

    <el-card shadow="never" class="filter-card">
      <el-form inline>
        <el-form-item label="关键词">
          <el-input v-model="keyword" placeholder="搜索问题 / 关键词 / 答案" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item label="品类">
          <el-select v-model="category" placeholder="全部品类" clearable style="width: 130px">
            <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="faqCategory" placeholder="全部分类" clearable style="width: 140px">
            <el-option v-for="t in FAQ_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="resetFilters">清除筛选</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>常见问题（{{ filtered.length }} 条，模拟数据）</span>
        </div>
      </template>

      <div v-if="loading" v-loading="true" class="loading-block" element-loading-text="知识库加载中..." />

      <template v-else-if="error">
        <el-result icon="error" title="知识库加载失败" sub-title="请检查服务状态后重试">
          <template #extra><el-button type="primary" @click="load">重新加载</el-button></template>
        </el-result>
      </template>

      <template v-else>
        <el-empty v-if="filtered.length === 0" description="没有匹配的 FAQ，请调整关键词或筛选条件" />
        <el-collapse v-else v-model="openIds">
          <el-collapse-item v-for="f in filtered" :key="f.id" :name="f.id">
            <template #title>
              <div class="q-row">
                <el-tag size="small" effect="plain">{{ f.id }}</el-tag>
                <el-tag size="small" :type="f.safetyLevel === 'high' ? 'danger' : f.safetyLevel === 'medium' ? 'warning' : 'info'" effect="plain">
                  {{ SAFETY_TEXT[f.safetyLevel] }}
                </el-tag>
                <span class="q-text">{{ f.question }}</span>
              </div>
            </template>
            <p class="answer">{{ f.answer }}</p>
            <p class="meta">分类：{{ f.category }} ｜ 适用品类：{{ f.applicableCategories.join('、') }} ｜ {{ f.sourceNote }}</p>
          </el-collapse-item>
        </el-collapse>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.mark { margin-bottom: 12px; }
.filter-card { margin-bottom: 12px; }
.head { font-weight: 600; color: #0b6e6e; }
.loading-block { min-height: 200px; }
.q-row { display: flex; align-items: center; gap: 8px; }
.q-text { font-size: 14px; }
.answer { line-height: 1.8; color: #1f2d3d; }
.meta { font-size: 12px; color: #9aa8b5; }
</style>
