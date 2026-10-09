import { ROOM_V2_SESSION_AUDIENCE } from '@dhgc/shared/desktop'

export interface RoomV2Session {
  aud: typeof ROOM_V2_SESSION_AUDIENCE
  roomId: string
  inviteCode: string
  playerId: string
  nickname: string
  exp: number
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

function secretKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signRoomV2Session(secret: string, payload: Omit<RoomV2Session, 'aud' | 'exp'>): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify({ ...payload, aud: ROOM_V2_SESSION_AUDIENCE, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60 })))
  const signature = await crypto.subtle.sign('HMAC', await secretKey(secret), new TextEncoder().encode(body))
  return `${body}.${base64url(new Uint8Array(signature))}`
}

export async function verifyRoomV2Session(secret: string, token: string): Promise<RoomV2Session | null> {
  try {
    const [body, signature, extra] = token.split('.')
    if (!body || !signature || extra) return null
    const valid = await crypto.subtle.verify('HMAC', await secretKey(secret), decode(signature), new TextEncoder().encode(body))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(decode(body))) as RoomV2Session
    if (payload.aud !== ROOM_V2_SESSION_AUDIENCE || !Number.isSafeInteger(payload.exp) || payload.exp <= Date.now() / 1000 ||
      typeof payload.roomId !== 'string' || typeof payload.inviteCode !== 'string' || typeof payload.playerId !== 'string' || typeof payload.nickname !== 'string') return null
    return payload
  } catch { return null }
}
