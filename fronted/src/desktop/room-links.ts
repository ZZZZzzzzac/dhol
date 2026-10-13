export function roomCodeFromSearch(search: string): string | null {
  const code = new URLSearchParams(search).get('room')?.trim().toUpperCase()
  return code && /^[A-Z0-9]{6}$/.test(code) ? code : null
}

export function buildRoomLink(href: string, inviteCode: string): string {
  const url = new URL(href)
  url.search = new URLSearchParams({ room: inviteCode }).toString()
  url.hash = ''
  url.username = ''
  url.password = ''
  return url.toString()
}
