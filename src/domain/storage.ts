import { Session } from './types'

const STORAGE_KEY = 'volley-board-session-v1'

export interface SessionLoadResult {
  session: Session | null
  warning: string | null
}

export function loadSessionResult(): SessionLoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { session: null, warning: null }
    const parsed = JSON.parse(raw) as Session
    if (parsed.version !== 1 || !Array.isArray(parsed.rounds) || !Array.isArray(parsed.teams)) {
      return { session: null, warning: '保存データの形式を確認できませんでした。既存データは初期化していません。' }
    }
    return { session: parsed, warning: null }
  } catch {
    return { session: null, warning: '保存データを読み込めませんでした。既存データは初期化していません。' }
  }
}

export function loadSession(): Session | null {
  return loadSessionResult().session
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}
