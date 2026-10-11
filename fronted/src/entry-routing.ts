export type FrontendEntry = 'maintenance' | 'preview' | 'legacy-retired'

export function selectEntry(pathname: string, dev: boolean, previewEnabled: boolean): FrontendEntry {
  if (/^\/rooms?(?:\/|$)/.test(pathname)) return 'legacy-retired'
  if (/^\/preview\/?$/.test(pathname) && (dev || previewEnabled)) return 'preview'
  return 'maintenance'
}
