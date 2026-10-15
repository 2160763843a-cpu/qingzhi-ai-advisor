<template>
  <div class="leads-page">
    <h1 class="page-title">线索管理</h1>
    <p class="page-sub">模拟演示角色（非真实登录鉴权）。所有记录仅保存在当前浏览器 localStorage，不会提交给真实企业。</p>

    <template v-if="role === 'operator'">
      <div class="metric-row">
        <div class="metric"><b>{{ store.total.value }}</b><span>总记录</span></div>
        <div class="metric"><b>{{ store.byType('purchase_lead').length }}</b><span>购买线索</span></div>
        <div class="metric"><b>{{ store.byType('after_sales_case').length }}</b><span>售后记录</span></div>
        <div class="metric"><b>{{ store.byType('complaint_case').length }}</b><span>投诉记录</span></div>
        <div class="metric"><b>{{ store.highIntentCount.value }}</b><span>高意向</span></div>
      </div>

      <el-card shadow="never" class="filter-bar">
        <div class="filters">
          <el-select v-model="fType" placeholder="类型" size="small" clearable style="width: 130px">
            <el-option label="购买线索" value="purchase_lead" />
            <el-option label="售后记录" value="after_sales_case" />
            <el-option label="投诉记录" value="complaint_case" />
          </el-select>
          <el-select v-model="fStatus" placeholder="状态" size="small" clearable style="width: 130px">
            <el-option v-for="s in allStatuses" :key="s" :label="s" :value="s" />
          </el-select>
          <el-select v-model="fLevel" placeholder="意向等级" size="small" clearable style="width: 120px">
            <el-option label="高" value="高" />
            <el-option label="中" value="中" />
            <el-option label="低" value="低" />
          </el-select>
          <el-input v-model="keyword" placeholder="关键词搜索" size="small" style="width: 180px" clearable />
          <el-button size="small" @click="exportJson">导出 JSON（脱敏）</el-button>
        </div>
      </el-card>

      <el-card shadow="never">
        <el-table :data="filtered" stripe size="small">
          <el-table-column prop="id" label="编号" width="150" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ typeName(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="needsSummary" label="需求摘要" min-width="200" show-overflow-tooltip />
          <el-table-column label="意向/优先级" width="100">
            <template #default="{ row }">{{ row.intentLevel ?? row.priority ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="联系方式" width="130">
            <template #default="{ row }">{{ contactText(row) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="audit-card">
        <h2 class="panel-title">审计记录（{{ store.audit.length }}）</h2>
        <ul class="audit-list">
          <li v-for="a in [...store.audit].reverse().slice(0, 30)" :key="a.auditId">
            [{{ fmtTime(a.timestamp) }}] {{ ROLE[a.actorRole] ?? a.actorRole }} · {{ AUDIT_ACTION[a.action] ?? a.action }} · {{ a.targetId ?? '—' }} · {{ a.result }} · {{ a.nonSensitiveSummary }}
          </li>
        </ul>
      </el-card>

      <el-drawer v-model="drawer" :title="current?.id" size="420px">
        <div v-if="current" class="detail">
          <p><b>类型：</b>{{ typeName(current.type) }} ｜ <b>状态：</b>{{ current.status }}（模拟状态）</p>
          <p v-if="current.type === 'purchase_lead'">
            <b>意向分：</b>{{ current.intentScore }}（{{ current.intentLevel }}）
          </p>
          <ul v-if="current.scoreItems?.length" class="score-items">
            <li v-for="i in current.scoreItems" :key="i.key">{{ i.label }} +{{ i.score }}（{{ i.basis }}）</li>
          </ul>
          <p><b>需求摘要：</b>{{ current.needsSummary }}</p>
          <p v-if="current.faqId"><b>已匹配FAQ：</b>{{ current.faqId }} ｜ <b>已尝试建议：</b>{{ current.triedSuggestion ? '是' : '否' }}</p>
          <p v-if="current.type !== 'purchase_lead'"><b>服务优先级：</b>{{ current.priority }}</p>
          <p><b>期望/下一步：</b>{{ current.requestedAction }}</p>
          <p><b>授权：</b>{{ current.consent.given ? `已授权（${fmtTime(current.consent.givenAt ?? '')}）` : '未授权或已撤回' }}</p>
          <p><b>联系方式：</b>{{ contactText(current) }}
            <el-button v-if="canShowFull(current)" size="small" link type="warning" @click="showFull">查看完整（二次确认）</el-button>
          </p>
          <p v-if="fullPhone" class="full-phone">完整号码（仅本次演示可见）：{{ fullPhone }}</p>
          <div class="detail-ops">
            <el-select :model-value="current.status" size="small" style="width: 150px" @change="changeStatus($event as string)">
              <el-option v-for="s in statusesOf(current.type)" :key="s" :label="s" :value="s" />
            </el-select>
            <el-input v-model="noteText" size="small" placeholder="模拟备注（不含敏感信息）" style="flex: 1" />
            <el-button size="small" @click="addNote">添加备注</el-button>
          </div>
          <p v-if="statusMsg" class="status-msg">{{ statusMsg }}</p>
          <div class="detail-ops">
            <el-button size="small" type="warning" plain @click="withdraw">撤回授权</el-button>
            <el-button size="small" type="danger" plain @click="removeRecord">删除记录</el-button>
          </div>
        </div>
      </el-drawer>
    </template>

    <template v-else>
      <el-card shadow="never">
        <h2 class="panel-title">消费者视图（仅当前会话记录）</h2>
        <p class="hint">你正在使用消费者演示身份，只能查看当前会话生成的记录。如需查看全部演示数据，请在页头切换为“运营人员演示”。</p>
        <el-table :data="ownRecords" stripe size="small">
          <el-table-column prop="id" label="编号" width="150" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ typeName(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="needsSummary" label="摘要" min-width="180" show-overflow-tooltip />
          <el-table-column label="联系方式" width="130">
            <template #default="{ row }">{{ contactText(row) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100" />
        </el-table>
        <div class="state-ops">
          <el-button size="small" @click="exportJson">导出我的数据（JSON·脱敏）</el-button>
        </div>
        <p class="hint">联系方式已默认脱敏；你可在会话中撤回授权，或联系演示流程删除记录。</p>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAppLeadsStore, type BusinessRecord, type BusinessRecordType } from '../stores/leads'
import { useRoleStore } from '../stores/role'
import { RECORD_TYPE, AUDIT_ACTION, ROLE } from '../labels/businessLabels'
const roleStore = useRoleStore()
import { maskPhone } from '../engine/leadScore'
import { createAdvisor } from '../engine/engine'
import { createBrowserStore } from '../engine/session'

const store = getAppLeadsStore()
const role = computed(() => roleStore.state.current)
const version = ref(0)
const fType = ref<BusinessRecordType | ''>('')
const fStatus = ref('')
const fLevel = ref('')
const keyword = ref('')
const drawer = ref(false)
const currentId = ref('')
const fullPhone = ref('')
const noteText = ref('')
const statusMsg = ref('')
const sessionId = ref('')

const advisor = createAdvisor(createBrowserStore().store)

const allStatuses = ['新建', '待确认', '跟进中', '已转化（模拟）', '待处理', '排查中', '待服务', '调查中', '协商中', '已解决', '已关闭']
const FLOWS: Record<string, string[]> = {
  purchase_lead: ['新建', '待确认', '跟进中', '已转化（模拟）', '已关闭'],
  after_sales_case: ['待处理', '排查中', '待服务', '已解决', '已关闭'],
  complaint_case: ['待处理', '调查中', '协商中', '已解决', '已关闭']
}
function statusesOf(t: string): string[] { return FLOWS[t] ?? [] }
function typeName(t: string): string { return RECORD_TYPE[t] ?? t }
function fmtTime(iso: string): string { return iso ? iso.slice(0, 16).replace('T', ' ') : '—' }
function contactText(r: BusinessRecord): string {
  if (!r.contact || r.contact.withdrawn) return '已撤回/未提供'
  return r.contact.phone ? maskPhone(r.contact.phone) : '未提供'
}
function canShowFull(r: BusinessRecord): boolean {
  return Boolean(r.contact?.phone) && !r.contact?.withdrawn && role.value === 'operator'
}

const filtered = computed(() => {
  void version.value
  let list = [...store.records].reverse()
  if (fType.value) list = list.filter((r) => r.type === fType.value)
  if (fStatus.value) list = list.filter((r) => r.status === fStatus.value)
  if (fLevel.value) list = list.filter((r) => r.intentLevel === fLevel.value)
  if (keyword.value) list = list.filter((r) => (r.needsSummary + r.id + r.conversationSummary).includes(keyword.value))
  return list
})
const ownRecords = computed(() => {
  void version.value
  return store.bySession(sessionId.value).slice().reverse()
})
const current = computed(() => {
  void version.value
  return store.records.find((r) => r.id === currentId.value) ?? null
})

function openDetail(r: BusinessRecord): void {
  currentId.value = r.id
  fullPhone.value = ''
  statusMsg.value = ''
  drawer.value = true
}
function changeStatus(next: string): void {
  if (!current.value) return
  const res = store.setStatus(current.value.id, next, role.value)
  statusMsg.value = res.ok ? '状态已更新（模拟状态，非真实交易结果）' : `无法更新：${res.reason}`
  version.value += 1
}
function addNote(): void {
  if (!current.value || !noteText.value.trim()) return
  store.addNote(current.value.id, role.value, noteText.value.trim())
  noteText.value = ''
  version.value += 1
  ElMessage.success('备注已添加（模拟）')
}
function showFull(): void {
  if (!current.value) return
  ElMessageBox.confirm('完整联系方式仅限模拟演示查看，将记录审计事件（sensitive_contact_viewed）。继续？', '二次确认', { type: 'warning', confirmButtonText: '查看', cancelButtonText: '取消' })
    .then(() => {
      fullPhone.value = store.viewSensitiveContact(current.value!.id, role.value) ?? '（无）'
      version.value += 1
    })
    .catch(() => undefined)
}
function withdraw(): void {
  if (!current.value) return
  ElMessageBox.confirm('撤回授权将立即删除完整联系方式（不可逆），仅保留非敏感业务摘要。继续？', '撤回授权', { type: 'warning' })
    .then(() => {
      store.withdrawConsent(current.value!.id, role.value)
      fullPhone.value = ''
      version.value += 1
      ElMessage.success('已撤回授权')
    })
    .catch(() => undefined)
}
function removeRecord(): void {
  if (!current.value) return
  ElMessageBox.confirm(`将删除记录 ${current.value.id}（含联系方式），删除后不可恢复；公共商品/FAQ数据不受影响。`, '删除记录', { type: 'warning' })
    .then(() => {
      store.remove(current.value!.id, role.value)
      drawer.value = false
      version.value += 1
      ElMessage.success('已删除')
    })
    .catch(() => undefined)
}
function exportJson(): void {
  const json = store.exportFor(role.value === 'consumer' ? sessionId.value : null)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'qzad-leads-simulated.json'
  a.click()
  URL.revokeObjectURL(url)
  version.value += 1
}

onMounted(() => {
  const ctx = advisor.getContext()
  sessionId.value = ctx?.sessionId ?? 'S-unknown'
  version.value += 1
})
</script>

<style scoped>
.leads-page { max-width: 1080px; margin: 0 auto; }
.page-title { font-size: 22px; margin: 6px 0 4px; }
.page-sub { color: #7a8a99; font-size: 13px; margin: 0 0 12px; }
.metric-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.metric { flex: 1; min-width: 110px; background: #fff; border: 1px solid #e6ebf0; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; }
.metric b { font-size: 20px; color: #0b6e6e; }
.metric span { font-size: 12px; color: #7a8a99; }
.filter-bar { margin-bottom: 12px; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.panel-title { font-size: 15px; margin: 2px 0 8px; }
.audit-card { margin-top: 12px; }
.audit-list { margin: 0; padding-left: 16px; font-size: 12px; color: #5b6b7b; line-height: 1.9; }
.detail p { margin: 6px 0; font-size: 13px; line-height: 1.6; }
.score-items { margin: 4px 0 8px; padding-left: 18px; font-size: 12px; color: #5b6b7b; }
.detail-ops { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.status-msg { color: #a15c00; font-size: 12px; }
.full-phone { color: #a33; font-weight: 600; }
.hint { color: #7a8a99; font-size: 12px; }
.state-ops { margin: 10px 0; }
</style>
