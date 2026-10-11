export const LEGACY_CLEANUP_MARKER = 'dhol:maintenance:legacy-storage-cleanup:v1'

const LEGACY_KEYS = new Set([
  'dhgc:room',
  'dhgc:token',
  'dhgc:queue',
  'dhol:legacy:room',
  'dhol:legacy:token',
  'dhol:legacy:queue',
  'dhol:legacy:session',
])

const LEGACY_PREFIXES = [
  'gm-panel:',
  'mobile-panel:',
  'dhgc:legacy:',
]

export function retireLegacyBrowserStorage(storage: Storage): boolean {
  if (storage.getItem(LEGACY_CLEANUP_MARKER) === '1') return false
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null)
  for (const key of keys) {
    if (LEGACY_KEYS.has(key) || LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) storage.removeItem(key)
  }
  storage.setItem(LEGACY_CLEANUP_MARKER, '1')
  return true
}
