import type { CountdownClock } from './components/CountdownTracker'

export function loadCountdowns(storage: Pick<Storage, 'getItem'>, key: string): CountdownClock[] {
  try {
    const saved = storage.getItem(key)
    return saved ? JSON.parse(saved) as CountdownClock[] : []
  } catch {
    return []
  }
}

export function clearRoomBrowserState(storage: Storage, roomId: string): void {
  const keys = [`dhol-countdowns-${roomId}`, `dhol-roomlog-${roomId}`]
  const outboxPrefix = `dhol:desktop:v2:outbox:${roomId}:`
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(outboxPrefix)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}
