import type { ChangeLogEntry, SessionContext, SlotKey } from './types.ts'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const MAX_MESSAGES = 60
const MAX_INTENT_HISTORY = 30
const MAX_CHANGE_LOG = 40

export function createSessionContext(sessionId?: string): SessionContext {
  const now = Date.now()
  return {
    sessionId: sessionId ?? `S-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    turnCount: 0,
    currentIntent: null,
    intentHistory: [],
    slots: {},
    changeLog: [],
    pendingAsk: null,
    askCounts: {},
    stage: 'greeting',
    dialogueState: 'idle',
    complaint: null,
    complaintMigrated: false,
    recentMessages: [],
    createdAt: now,
    updatedAt: now
  }
}

export class SessionStore {
  private storage: StorageLike
  private key: string

  constructor(storage: StorageLike, key = 'qzad.session.v1') {
    this.storage = storage
    this.key = key
  }

  load(): SessionContext | null {
    try {
      const raw = this.storage.getItem(this.key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as SessionContext
      if (!parsed || typeof parsed.sessionId !== 'string' || !parsed.slots) return null
      return parsed
    } catch {
      return null
    }
  }

  save(ctx: SessionContext): void {
    ctx.recentMessages = ctx.recentMessages.slice(-MAX_MESSAGES)
    ctx.intentHistory = ctx.intentHistory.slice(-MAX_INTENT_HISTORY)
    ctx.changeLog = ctx.changeLog.slice(-MAX_CHANGE_LOG)
    ctx.updatedAt = Date.now()
    try {
      this.storage.setItem(this.key, JSON.stringify(ctx))
    } catch {
      // 存储不可用时静默降级：会话仅保存在内存中
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key)
    } catch {
      // ignore
    }
  }
}

export function createBrowserStore(): { store: SessionStore; persistent: boolean } {
  try {
    const probe = '__qzad_probe__'
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    return { store: new SessionStore(globalThis.localStorage), persistent: true }
  } catch {
    return { store: new SessionStore(new MemoryStorage()), persistent: false }
  }
}

export function logChange(ctx: SessionContext, entry: Omit<ChangeLogEntry, 'turn'>, turn: number): void {
  ctx.changeLog.push({ ...entry, turn })
}

export function getSlotValue<T>(ctx: SessionContext, key: SlotKey): T | undefined {
  return ctx.slots[key]?.value as T | undefined
}
