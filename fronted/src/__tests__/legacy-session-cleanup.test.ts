import { describe, expect, it } from 'vitest'
import { LEGACY_CLEANUP_MARKER, retireLegacyBrowserStorage } from '../legacy-session-cleanup'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear(): void { throw new Error('localStorage.clear() must never be used') }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('legacy browser storage cleanup', () => {
  it('removes only explicit legacy keys and prefixes', () => {
    const storage = new MemoryStorage()
    for (const [key, value] of Object.entries({
      'dhgc:dice-presets:v1': 'legacy-dice',
      'gm-panel:battle-panel:old-room': 'legacy-battle',
      'gm-panel:notebook:old-room': 'legacy-notes',
      'gm-panel:notebook-position:old-room': 'legacy-position',
      'dhol:legacy:room': 'legacy-room',
      'dhol:legacy:token': 'legacy-token',
      'dhol:legacy:queue': 'legacy-queue',
      'dhol:desktop:v2:session': 'v2-session',
      'dhol:desktop:v2:outbox:room': 'v2-queue',
      'dhol:preview:notice': 'preview',
      'dh-character-builder:save': 'character',
      'unrelated-origin-data': 'keep',
    })) storage.setItem(key, value)

    expect(retireLegacyBrowserStorage(storage)).toBe(true)
    expect(storage.getItem('dhgc:dice-presets:v1')).toBe('legacy-dice')
    expect(storage.getItem('gm-panel:battle-panel:old-room')).toBeNull()
    expect(storage.getItem('dhol:legacy:room')).toBeNull()
    expect(storage.getItem('dhol:desktop:v2:session')).toBe('v2-session')
    expect(storage.getItem('dhol:desktop:v2:outbox:room')).toBe('v2-queue')
    expect(storage.getItem('dhol:preview:notice')).toBe('preview')
    expect(storage.getItem('dh-character-builder:save')).toBe('character')
    expect(storage.getItem('unrelated-origin-data')).toBe('keep')
    expect(storage.getItem(LEGACY_CLEANUP_MARKER)).toBe('1')
  })

  it('uses a durable marker and does not repeat cleanup', () => {
    const storage = new MemoryStorage()
    expect(retireLegacyBrowserStorage(storage)).toBe(true)
    storage.setItem('gm-panel:notebook:late-cache', 'left alone after migration')

    expect(retireLegacyBrowserStorage(storage)).toBe(false)
    expect(storage.getItem('gm-panel:notebook:late-cache')).toBe('left alone after migration')
  })
})
