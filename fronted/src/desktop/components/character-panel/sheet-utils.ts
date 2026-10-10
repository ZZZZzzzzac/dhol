export function safeImageSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const source = value.trim()
  return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(source) ? source : null
}
