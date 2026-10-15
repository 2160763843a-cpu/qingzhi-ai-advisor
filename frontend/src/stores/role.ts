// 唯一角色源：所有组件共享，先更新响应式后持久化；非浏览器环境安全回退 consumer
import { computed, reactive } from 'vue'
export type DemoRole = 'consumer' | 'operator'
export type ActorRole = DemoRole
const KEY = 'qzad.role.v1'
const state = reactive({ current: 'consumer' as DemoRole })
let hydrated = false
export function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try { const r = globalThis.localStorage?.getItem(KEY); if (r === 'operator' || r === 'consumer') state.current = r } catch { /* SSR/禁用存储 */ }
}
export function setRole(role: DemoRole): void {
  state.current = role
  try { globalThis.localStorage?.setItem(KEY, role) } catch { /* 忽略 */ }
}
export function reset(): void { setRole('consumer') }
export function isOperator() { return state.current === 'operator' }
export const isOperatorComputed = computed(() => state.current === 'operator')
export function useRoleStore() {
  hydrate()
  return { state, current: state, get current_role() { return state.current }, isOperator: computed(() => state.current === 'operator'), setRole, reset, hydrate }
}
