export function isPreviewEnabled(pathname: string, dev: boolean, enabled: boolean): boolean {
  return (dev || enabled) && /^\/preview\/?$/.test(pathname)
}
