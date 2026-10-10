import { DurableObject } from 'cloudflare:workers'
import { parseMutationCommand, parseSyncRequest, type CharacterSheetJson, type MutationError, type RoomEvent, type RoomSnapshot } from '@dhgc/shared/desktop'
import { CommandFailure, RoomV2Commands } from './room-v2-commands'
import { verifyRoomV2Session, type RoomV2Session } from './room-v2-session'
import { RoomV2Storage, type StoredMeta } from './room-v2-storage'

export interface RoomV2Env {
  ROOMS_V2: DurableObjectNamespace<RoomV2DurableObject>
  SESSION_SECRET: string
  ALLOWED_ORIGIN?: string
  CHARACTER_INGEST_ORIGINS?: string
}

function json(body: unknown, status = 200): Response { return Response.json(body, { status }) }

export class RoomV2DurableObject extends DurableObject<RoomV2Env> {
  private readonly db: RoomV2Storage
  private readonly commands: RoomV2Commands

  constructor(ctx: DurableObjectState, env: RoomV2Env) {
    super(ctx, env)
    this.db = new RoomV2Storage(ctx.storage)
    this.commands = new RoomV2Commands(this.db, event => this.broadcast(event), {
      onRollMetric: metric => console.log(JSON.stringify({ type: 'room_v2_roll_metric', ...metric })),
    })
    ctx.blockConcurrencyWhile(async () => { this.db.initialize() })
  }

  private onlineIds(): Set<string> {
    return new Set(this.ctx.getWebSockets().flatMap(socket => {
      const session = socket.deserializeAttachment() as RoomV2Session | null
      return session?.playerId ? [session.playerId] : []
    }))
  }

  private async session(request: Request): Promise<RoomV2Session | null> {
    const url = new URL(request.url)
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '')
    const token = bearer ?? url.searchParams.get('token') ?? ''
    const session = await verifyRoomV2Session(this.env.SESSION_SECRET, token)
    if (!session) return null
    const access = this.db.sessionAccess(session.playerId)
    if (!access || session.roomId !== access.roomId || session.inviteCode !== access.inviteCode || !access.member) return null
    return session
  }

  private expired(): boolean {
    const expiresAt = this.db.roomExpiresAt()
    return !expiresAt || Date.parse(expiresAt) <= Date.now()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/internal/v2/create' && request.method === 'POST') {
      const meta = await request.json() as StoredMeta
      if (!this.db.create(meta)) return json({ code: 'INVITE_COLLISION' }, 409)
      try { await this.ctx.storage.setAlarm(Date.parse(meta.expiresAt)) }
      catch {
        await this.ctx.storage.deleteAll()
        this.db.resetAfterDelete()
        return json({ code: 'PERSISTENCE_FAILED' }, 503)
      }
      return json({ room: this.db.snapshot('', [], this.onlineIds())!.room, player: meta.players[0] })
    }
    if (url.pathname === '/internal/v2/restore' && request.method === 'POST') {
      const input = await request.json() as { meta: StoredMeta; state: Parameters<RoomV2Storage['restore']>[1] }
      if (!this.db.restore(input.meta, input.state)) return json({ code: 'INVITE_COLLISION' }, 409)
      try { await this.ctx.storage.setAlarm(Date.parse(input.meta.expiresAt)) }
      catch { await this.ctx.storage.deleteAll(); this.db.resetAfterDelete(); return json({ code: 'PERSISTENCE_FAILED' }, 503) }
      return json({ room: this.db.snapshot('', [], this.onlineIds())!.room, player: input.meta.players[0] })
    }
    if (url.pathname === '/internal/v2/join' && request.method === 'POST') {
      const input = await request.json() as { playerId: string; nickname: string }
      const meta = this.db.meta()
      if (!meta) return json({ code: 'ROOM_NOT_FOUND' }, 404)
      if (this.expired()) return json({ code: 'ROOM_EXPIRED' }, 410)
      if (meta.players.length >= 16) return json({ code: 'ROOM_FULL' }, 409)
      meta.players.push({ id: input.playerId, nickname: input.nickname })
      this.db.updateMeta(meta)
      return json({ room: this.db.snapshot('', [], this.onlineIds())!.room, player: meta.players.at(-1) })
    }
    if (url.pathname === '/internal/v2/replace' && request.method === 'POST') {
      const meta = this.db.meta()
      if (!meta) return json({ code: 'ROOM_NOT_FOUND' }, 404)
      if (Date.parse(meta.expiresAt) <= Date.now()) return json({ code: 'ROOM_EXPIRED' }, 410)
      const input = await request.json() as { requestId: string; sheet: CharacterSheetJson }
      try {
        const result = await this.commands.replace('delivery', input.requestId, input.sheet)
        return json({ ok: true, action: result.action, name: input.sheet.name.trim(), generation: result.ack.seq, seq: result.ack.seq })
      } catch (error) {
        if (error instanceof CommandFailure && error.code === 'ROOM_EXPIRED') return json({ code: 'ROOM_EXPIRED' }, 410)
        if (error instanceof CommandFailure && error.code === 'REQUEST_ID_REUSED') return json({ code: 'INVALID_CHARACTER' }, 409)
        return json({ code: 'PERSISTENCE_FAILED' }, 503)
      }
    }
    const session = await this.session(request)
    if (!session) return json({ code: 'UNAUTHORIZED' }, 401)
    if (this.expired()) return json({ code: 'ROOM_EXPIRED' }, 410)
    if (url.pathname === '/internal/v2/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
      server.serializeAttachment(session)
      this.ctx.acceptWebSocket(server, [`player:${session.playerId}`])
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname === '/internal/v2/snapshot' && request.method === 'GET') return json(this.db.snapshot(session.playerId, [], this.onlineIds()))
    if (url.pathname === '/internal/v2/export' && request.method === 'GET') return json(this.db.export())
    const characterMatch = url.pathname.match(/^\/internal\/v2\/characters\/([^/]+)$/)
    if (characterMatch && request.method === 'GET') {
      let name: string
      try { name = decodeURIComponent(characterMatch[1]) } catch { return json({ code: 'INVALID_CHARACTER' }, 400) }
      const item = this.db.sheet(name)
      if (!item) return json({ code: 'CHARACTER_NOT_FOUND' }, 404)
      const generation = Number(url.searchParams.get('generation'))
      if (generation !== item.generation) return json({ code: 'CHARACTER_REPLACED', generation: item.generation }, 409)
      return json(item)
    }
    return json({ code: 'NOT_FOUND' }, 404)
  }

  private send(socket: WebSocket, value: unknown): void { socket.send(JSON.stringify(value)) }

  private sendSnapshot(socket: WebSocket, session: RoomV2Session, pendingRequestIds: string[]): void {
    const data = this.db.snapshot(session.playerId, pendingRequestIds, this.onlineIds())
    if (!data) return
    const message: RoomSnapshot = { type: 'room.snapshot', protocolVersion: 2, ...data }
    this.send(socket, message)
  }

  private broadcast(event: RoomEvent): void {
    const message = JSON.stringify(event)
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message) } catch { /* closed socket */ }
    }
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const session = socket.deserializeAttachment() as RoomV2Session | null
    if (!session || session.exp <= Date.now() / 1000) { socket.close(1008, 'Session expired'); return }
    const access = this.db.sessionAccess(session.playerId)
    if (!access || session.roomId !== access.roomId || session.inviteCode !== access.inviteCode || !access.member) { socket.close(1008, 'Session expired'); return }
    if (Date.parse(access.expiresAt) <= Date.now()) { socket.close(1008, 'Room expired'); return }
    let input: unknown
    try { input = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) }
    catch { this.send(socket, { type: 'operation.error', requestId: '', code: 'INVALID_COMMAND', message: '无效 JSON' }); return }
    if (typeof input === 'object' && input !== null && 'type' in input && input.type === 'room.sync') {
      try { this.sendSnapshot(socket, session, parseSyncRequest(input).pendingRequestIds) }
      catch { this.send(socket, { type: 'operation.error', requestId: '', code: 'INVALID_COMMAND', message: '同步请求无效' }) }
      return
    }
    let requestId = ''
    try {
      const command = parseMutationCommand(input)
      requestId = command.requestId
      const result = await this.commands.mutate(session.playerId, session.nickname, command)
      this.send(socket, result.ack)
    } catch (error) {
      const code: MutationError['code'] = error instanceof CommandFailure ? error.code : 'INVALID_COMMAND'
      this.send(socket, { type: 'operation.error', requestId, code, message: error instanceof Error ? error.message : '命令无效' })
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try { socket.close(code, reason) } catch { /* already closed */ }
  }
  async webSocketError(socket: WebSocket): Promise<void> { try { socket.close(1011, 'Socket error') } catch { /* already closed */ } }

  async alarm(): Promise<void> {
    const meta = this.db.meta()
    if (!meta) return
    if (Date.parse(meta.expiresAt) > Date.now()) { await this.ctx.storage.setAlarm(Date.parse(meta.expiresAt)); return }
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'Room expired')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.db.resetAfterDelete()
  }
}
