<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAppCompareStore, type CompareItem } from '../stores/compare'
import { fetchProducts } from '../api/client'
import type { Category, Product } from '../types/data'
import { CATEGORIES } from '../types/data'

const router = useRouter()
const loading = ref(true)
const compareStore = getAppCompareStore()
const compareVersion = ref(0)

function inCompare(id: string): boolean {
  return compareStore.items.some((i: CompareItem) => i.productId === id)
}
async function handleCompare(row: Product) {
  const r = compareStore.add(row, '商品库')
  compareVersion.value += 1
  if (r.ok) {
    ElMessage.success(compareStore.items.length >= 2 ? `已加入对比（${compareStore.items.length}/3），可以查看对比` : `已加入对比（${compareStore.items.length}/3），请再选择至少 1 款`)
    return
  }
  if (r.code === 'duplicate') { ElMessage.info('该商品已在对比列表中'); return }
  if (r.code === 'category_mismatch') {
    try {
      await ElMessageBox.confirm(
        `不同品类适合组成家庭方案，不适合逐项参数比较。当前对比列表是「${r.existingCategory}」。是否用「${row.name}」替换当前对比列表？`,
        '品类不同',
        { confirmButtonText: '替换对比列表', cancelButtonText: '保留当前品类', type: 'warning' }
      )
      compareStore.replaceWith(row, '商品库')
      compareVersion.value += 1
      ElMessage.success('已替换对比列表')
    } catch { ElMessage.info('已保留当前品类对比列表') }
    return
  }
  if (r.code === 'full') {
    const snapshot = [...compareStore.items]
    for (const item of snapshot) {
      try {
        await ElMessageBox.confirm(`对比列表已满（3/3）。是否移除「${item.name}」并加入「${row.name}」？`, '选择要移除的商品', { confirmButtonText: `移除「${item.name}」`, cancelButtonText: '看看下一款' })
        compareStore.removeById(item.productId, '商品库')
        compareStore.add(row, '商品库')
        compareVersion.value += 1
        ElMessage.success('已更新对比列表')
        return
      } catch { /* 询问下一款 */ }
    }
    ElMessage.info('已保留当前对比列表')
  }
}
function goCompare(): void {
  router.push('/compare')
}
function removeCompare(id: string): void {
  compareStore.removeById(id, '商品库')
  compareVersion.value += 1
}
async function clearCompare(): Promise<void> {
  compareStore.clear('商品库')
  compareVersion.value += 1
  ElMessage.success('已清空对比列表')
}
const error = ref(false)
const all = ref<Product[]>([])

const category = ref<Category | ''>('')
const priceMin = ref<number | undefined>(undefined)
const priceMax = ref<number | undefined>(undefined)
const keyword = ref('')
const page = ref(1)
const pageSize = 10

async function load() {
  loading.value = true
  error.value = false
  try {
    all.value = await fetchProducts()
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  const removed = compareStore.prune(all.value.map((x) => x.id))
  if (removed.length > 0) ElMessage.warning(`已自动移除失效的对比商品：${removed.map((r) => r.name).join('、')}`)
})

const filtered = computed(() => {
  return all.value.filter((p) => {
    if (category.value && p.category !== category.value) return false
    if (priceMin.value !== undefined && priceMin.value !== null && p.price < priceMin.value) return false
    if (priceMax.value !== undefined && priceMax.value !== null && p.price > priceMax.value) return false
    const kw = keyword.value.trim()
    if (kw) {
      const hay = `${p.name} ${p.brand} ${p.category} ${p.tags.join(' ')}`.toLowerCase()
      if (!hay.includes(kw.toLowerCase())) return false
    }
    return true
  })
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize
  return filtered.value.slice(start, start + pageSize)
})

function specText(p: Product): string {
  switch (p.category) {
    case '冰箱':
      return `容量 ${p.capacityL}L / 冷冻 ${p.freezerCapacityL}L${p.deepFreeze ? ' / 深冷速冻' : ''}`
    case '洗衣机':
      return `洗涤 ${p.washCapacityKg}kg / 脱水 ${p.spinSpeedRpm}rpm`
    case '空调':
      return `${p.horsepower}匹${p.suitableArea ? ` / 适用 ${p.suitableArea[0]}-${p.suitableArea[1]}㎡` : ''}`
    case '热水器':
      return `${p.literL}L / ${p.heatType}`
    case '电视':
      return `${p.inchSize}英寸 / ${p.resolution}`
    case '洗碗机':
      return `${p.placeSets}套 / ${p.dryType}`
  }
}

function resetFilters() {
  category.value = ''
  priceMin.value = undefined
  priceMax.value = undefined
  keyword.value = ''
  page.value = 1
}
</script>

<template>
  <div>
    <el-alert
      type="warning"
      :closable="false"
      title="模拟数据标识：以下商品、品牌、价格与参数均为模拟数据，仅供赛题演示"
      class="mark"
    />

    <el-card v-if="compareStore.items.length" :key="compareVersion" shadow="never" class="compare-bar">
      <div class="cmp-bar-row">
        <span class="cmp-bar-title">对比列表（{{ compareStore.count }}/3，{{ compareStore.category }}）：</span>
        <span v-for="i in compareStore.items" :key="i.productId" class="cmp-chip">
          {{ i.name }}（{{ i.price }}元）
          <el-button size="small" link type="danger" @click="removeCompare(i.productId)">移除</el-button>
        </span>
        <el-tooltip :content="compareStore.items.length >= 2 ? '' : '还需要再选择 1 款商品才能对比'" placement="top">
          <span>
            <el-button size="small" type="primary" :disabled="compareStore.items.length < 2" @click="goCompare">查看对比</el-button>
          </span>
        </el-tooltip>
        <el-button size="small" @click="clearCompare">清空</el-button>
      </div>
    </el-card>
    <el-card shadow="never" class="filter-card">
      <el-form inline :model="{}" label-width="72px">
        <el-form-item label="品类">
          <el-select v-model="category" placeholder="全部品类" clearable style="width: 140px">
            <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="价格区间">
          <el-input-number v-model="priceMin" :min="0" :max="30000" :step="100" placeholder="最低" controls-position="right" style="width: 120px" />
          <span class="dash">-</span>
          <el-input-number v-model="priceMax" :min="0" :max="30000" :step="100" placeholder="最高" controls-position="right" style="width: 120px" />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="keyword" placeholder="名称 / 品牌 / 标签" clearable style="width: 180px" @keyup.enter="page = 1" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="page = 1">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="error" shadow="never">
      <el-result icon="error" title="商品库加载失败" sub-title="请检查服务状态后重试">
        <template #extra><el-button type="primary" @click="load">重新加载</el-button></template>
      </el-result>
    </el-card>

    <el-card v-else shadow="never">
      <template #header>
        <div class="table-head">
          <span>商品列表</span>
          <el-tag type="info" effect="plain">共 {{ filtered.length }} 款（模拟数据）</el-tag>
        </div>
      </template>

      <el-table v-loading="loading" :data="paged" stripe>
        <el-table-column label="对比" width="110">
          <template #default="{ row }">
            <el-tag v-if="inCompare(row.id)" size="small" type="success" effect="plain">已加入</el-tag>
            <el-button v-if="!inCompare(row.id)" size="small" plain @click="handleCompare(row)">加入对比</el-button>
            <el-button v-else size="small" type="danger" plain @click="removeCompare(row.id)">移出对比</el-button>
          </template>
        </el-table-column>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand">
              <p><b>外形尺寸：</b>{{ row.dimensionsMm.width }} × {{ row.dimensionsMm.depth }} × {{ row.dimensionsMm.height }} mm（宽 × 深 × 高）</p>
              <p><b>适用家庭人数：</b>{{ row.familySizeFit[0] }}-{{ row.familySizeFit[1] }} 人</p>
              <p><b>核心卖点：</b>{{ row.sellingPoints.join('；') }}</p>
              <p><b>局限或注意事项：</b>{{ row.limitations.join('；') }}</p>
              <p><b>售后说明：</b>{{ row.afterSalesNote }}</p>
              <p><b>标签：</b>{{ row.tags.join('、') }}</p>
              <p class="src">{{ row.dataSource }}</p>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="name" label="商品名称" min-width="220" show-overflow-tooltip />
        <el-table-column prop="brand" label="品牌" width="150" />
        <el-table-column prop="category" label="品类" width="90" />
        <el-table-column label="核心规格" min-width="200">
          <template #default="{ row }">{{ specText(row) }}</template>
        </el-table-column>
        <el-table-column label="价格(元)" width="110">
          <template #default="{ row }">{{ row.price.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="energyGrade" label="能效" width="90" />
        <el-table-column label="噪声(dB)" width="100">
          <template #default="{ row }">{{ row.noiseDb.standard }}/{{ row.noiseDb.max }}</template>
        </el-table-column>
        <el-table-column prop="rating" label="评分" width="80" />
        <el-table-column prop="stockStatus" label="库存" width="100" />
      </el-table>

      <el-empty v-if="!loading && filtered.length === 0" description="没有符合筛选条件的商品，请调整品类、价格区间或关键词" />

      <div class="pager" v-if="filtered.length > pageSize">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="filtered.length"
          layout="prev, pager, next, total"
          background
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.mark {
  margin-bottom: 12px;
}
.filter-card {
  margin-bottom: 12px;
}
.dash {
  margin: 0 6px;
  color: #90a;
  color: #7a8a99;
}
.table-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.expand {
  padding: 0 16px;
  line-height: 1.9;
  color: #4a5a68;
  font-size: 13px;
}
.expand .src {
  color: #b08030;
}
.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.compare-bar { margin-bottom: 12px; }
.cmp-bar-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.cmp-bar-title { font-weight: 600; color: #0b6e6e; }
.cmp-chip { background: #f0f6f6; border-radius: 6px; padding: 2px 8px; }
</style>
