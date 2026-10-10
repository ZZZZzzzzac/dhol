import type { CharacterSummary, MutationCommand, RoomEvent, RoomServerMessage, RoomSnapshot, RoomV2Model } from '@dhgc/shared/desktop'
import { createRoomStore, type RoomStore } from './room-store'
import { createUiStore } from './ui-store'
import { RoomOutbox, type OutboxStorage, type PendingOperation } from '../sync/room-outbox'
import { RoomClient, type ConnectionStatus, type RoomClientOptions } from '../sync/room-client'

export type SaveStatus = 'saved' | 'saving' | 'failed'
type DraftCommand<T> = T extends MutationCommand ? Omit<T, 'requestId' | 'protocolVersion'> : never
export interface RoomSyncState { room: RoomV2Model | null; connection: ConnectionStatus; save: SaveStatus; reason: string | null }
export interface RoomSyncOptions {
  roomId: string
  actorId: string
  websocketUrl: string
  storage: OutboxStorage
  client?: Partial<Pick<RoomClientOptions, 'socketFactory' | 'setTimer' | 'clearTimer' | 'visibilityTarget'>>
}

function project(room: RoomV2Model, pending: PendingOperation[]): RoomV2Model {
  let view = room
  for (const entry of pending) {
    const command = entry.command
    if ('name' in command) {
      const character = view.characters.find(item => item.name === command.name && item.generation === command.generation)
      if (!character || command.type === 'character.delete') continue
      const resources = { ...character.resources }
      if (command.type === 'character.adjustHope') resources.hope = Math.max(0, Math.min(resources.hopeMax, resources.hope + command.delta))
      else {
        const track = resources[command.resource]
        if (command.index >= track.length) continue
        resources[command.resource] = track.map((mark, index) => index === command.index ? command.marked : mark)
      }
      view = { ...view, characters: view.characters.map(item => item === character ? { ...character, resources } : item) }
    } else if (command.type === 'room.adjustFear') view = { ...view, fear: { ...view.fear, value: Math.max(0, Math.min(view.fear.max, view.fear.value + command.delta)) } }
    else if (command.type === 'xcard.set') view = { ...view, xCard: { ...view.xCard, active: command.active } }
  }
  return view
}

function sameCharacter(left: CharacterSummary | undefined, right: CharacterSummary | undefined): boolean {
  if (left === right) return true
  if (!left || !right || left.generation !== right.generation) return false
  const a = left.resources; const b = right.resources
  return a.hope === b.hope && a.hopeMax === b.hopeMax &&
    (['hp', 'stress', 'armor'] as const).every(track => a[track].length === b[track].length && a[track].every((mark, index) => mark === b[track][index]))
}

export class RoomSync {
  readonly confirmed: RoomStore = createRoomStore()
  readonly ui = createUiStore()
  readonly outbox: RoomOutbox
  readonly client: RoomClient
  private subscribers = new Set<() => void>()
  private connection: ConnectionStatus = 'disconnected'
  private reason: string | null = null
  private save: SaveStatus = 'saved'
  private highestSeenSeq = 0
  private detailCache = new Map<string, unknown>()
  private confirmationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly setTimer: NonNullable<RoomClientOptions['setTimer']>
  private readonly clearTimer: NonNullable<RoomClientOptions['clearTimer']>
  private destroyed = false
  private viewState: RoomSyncState = { room: null, connection: 'disconnected', save: 'saved', reason: null }
  readonly options: RoomSyncOptions

  constructor(options: RoomSyncOptions) {
    this.options = options
    this.setTimer = options.client?.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms))
    this.clearTimer = options.client?.clearTimer ?? (handle => globalThis.clearTimeout(handle))
    this.outbox = new RoomOutbox(options.storage, options.roomId, options.actorId)
    this.save = this.outbox.list().length ? 'saving' : 'saved'
    this.client = new RoomClient({
      roomId: options.roomId, websocketUrl: options.websocketUrl,
      ...options.client,
      pendingIds: () => this.outbox.list().map(entry => entry.command.requestId),
      afterSeq: () => this.confirmed.getState().room?.seq ?? 0,
      onMessage: message => this.receive(message),
      onStatus: (status, reason) => { this.connection = status; this.reason = reason ?? null; this.emit() },
    })
    this.emit()
  }

  start(): void { this.client.connect() }
  subscribe(listener: () => void): () => void { this.subscribers.add(listener); return () => { this.subscribers.delete(listener) } }
  subscribeSelector<T>(selector: (state: RoomSyncState) => T, listener: () => void, equal: (left: T, right: T) => boolean = Object.is): () => void {
    let previous = selector(this.viewState)
    return this.subscribe(() => {
      const current = selector(this.viewState)
      if (!equal(previous, current)) { previous = current; listener() }
    })
  }
  character(name: string): CharacterSummary | undefined { return this.viewState.room?.characters.find(item => item.name === name) }
  subscribeCharacter(name: string, listener: () => void): () => void {
    return this.subscribeSelector(state => state.room?.characters.find(item => item.name === name), listener, sameCharacter)
  }
  subscribeDice(listener: () => void): () => void { return this.subscribeSelector(state => state.room?.dice, listener) }
  subscribeConnection(listener: () => void): () => void { return this.subscribeSelector(state => state.connection, listener) }
  private emit(): void {
    const room = this.confirmed.getState().room
    let projected = room ? project(room, this.outbox.list()) : null
    const previous = this.viewState.room
    if (projected && previous?.roomId === projected.roomId) {
      projected = { ...projected, characters: projected.characters.map(character => {
        const old = previous.characters.find(item => item.name === character.name)
        return sameCharacter(old, character) ? old! : character
      }) }
    }
    this.viewState = { room: projected, connection: this.connection, save: this.save, reason: this.reason }
    for (const listener of this.subscribers) listener()
  }
  getState(): RoomSyncState { return this.viewState }
  getConfirmed(): RoomV2Model | null { return this.confirmed.getState().room }
  pending(): PendingOperation[] { return this.outbox.list() }

  submit(command: DraftCommand<MutationCommand>): string {
    if (this.connection !== 'ready') throw new Error('连接尚未就绪')
    const requestId = crypto.randomUUID()
    const operation = { ...command, requestId, protocolVersion: 2 } as MutationCommand
    try { this.outbox.add(operation) }
    catch (error) { this.save = 'failed'; this.reason = error instanceof Error ? error.message : '浏览器存储失败'; this.emit(); throw error }
    this.save = 'saving'
    this.emit()
    if (!this.client.send(operation)) { this.reason = '操作已保存在本机，等待重连'; this.emit() }
    this.confirmationTimers.set(requestId, this.setTimer(() => {
      this.confirmationTimers.delete(requestId)
      if (this.outbox.list().some(entry => entry.command.requestId === requestId)) this.client.sync()
    }, 8000))
    return requestId
  }

  private finish(requestId: string, notify = true): void {
    const timer = this.confirmationTimers.get(requestId)
    if (timer) this.clearTimer(timer)
    this.confirmationTimers.delete(requestId)
    this.outbox.remove(requestId)
    this.save = this.outbox.list().length ? 'saving' : 'saved'
    if (notify) this.emit()
  }

  private receiveSnapshot(message: RoomSnapshot): void {
    if (message.room.roomId !== this.options.roomId) return
    const current = this.confirmed.getState().room
    if (!current || message.room.seq >= current.seq) this.confirmed.setRoom(message.room)
    const appliedSeq = this.confirmed.getState().room?.seq ?? 0
    if (current) for (const previous of current.characters) {
      const next = this.confirmed.getState().room?.characters.find(item => item.name === previous.name)
      if (!next || next.generation !== previous.generation) this.detailCache.delete(`${previous.name}:${previous.generation}`)
    }
    for (const receipt of message.receipts) {
      if (appliedSeq >= receipt.seq) this.finish(receipt.requestId)
      else this.outbox.acknowledge(receipt.requestId, receipt.seq)
    }
    for (const entry of this.outbox.list()) {
      const command = entry.command
      if ('name' in command) {
        const character = this.confirmed.getState().room?.characters.find(item => item.name === command.name)
        if (!character || character.generation !== command.generation) {
          this.finish(entry.command.requestId)
          this.ui.setNotice('角色已重新投递，旧卡未确认修改未应用')
        }
      }
    }
    if (this.highestSeenSeq > appliedSeq) { this.client.sync(); return }
    this.client.ready()
    for (const entry of this.outbox.list()) this.client.send(entry.command)
    this.emit()
  }

  receive(message: RoomServerMessage): void {
    if (this.destroyed) return
    if (message.type === 'room.snapshot') { this.receiveSnapshot(message); return }
    if (message.type === 'operation.ack') {
      const entry = this.outbox.list().find(item => item.command.requestId === message.requestId)
      if (!entry) return
      const seq = this.confirmed.getState().room?.seq ?? 0
      if (seq >= message.seq) this.finish(message.requestId)
      else { this.outbox.acknowledge(message.requestId, message.seq); this.emit() }
      return
    }
    if (message.type === 'operation.error') {
      if (message.code === 'CHARACTER_REPLACED' || message.code === 'INVALID_COMMAND' || message.code === 'REQUEST_ID_REUSED' || message.code === 'ROOM_EXPIRED') {
        this.outbox.remove(message.requestId)
        this.save = this.outbox.list().length ? 'saving' : 'failed'
        this.reason = message.message
        if (message.code === 'CHARACTER_REPLACED') { this.ui.setNotice('角色已重新投递，旧卡未确认修改未应用'); this.client.sync() }
      } else {
        this.save = 'failed'
        this.reason = message.message
      }
      this.emit()
      return
    }
    this.receiveEvent(message)
  }

  private receiveEvent(event: RoomEvent): void {
    const current = this.confirmed.getState().room
    if (!current) { this.highestSeenSeq = Math.max(this.highestSeenSeq, event.seq); this.client.sync(); return }
    if (event.seq <= current.seq) return
    if (event.seq !== current.seq + 1) { this.highestSeenSeq = Math.max(this.highestSeenSeq, event.seq); this.client.sync(); return }
    if (event.type === 'character.replaced') {
      const old = current.characters.find(item => item.name === event.name)
      if (old) {
        this.detailCache.delete(`${event.name}:${old.generation}`)
        const removed = this.outbox.removeGeneration(event.name, old.generation)
        if (removed.length) this.ui.setNotice('角色已重新投递，旧卡未确认修改未应用')
      }
    }
    this.confirmed.apply(event)
    if (this.outbox.list().some(entry => entry.command.requestId === event.requestId)) this.finish(event.requestId, false)
    this.emit()
  }

  async detail(name: string, generation: number, fetcher: (name: string, generation: number) => Promise<unknown>): Promise<unknown> {
    const key = `${name}:${generation}`
    if (this.detailCache.has(key)) return this.detailCache.get(key)
    const value = await fetcher(name, generation)
    const current = this.confirmed.getState().room?.characters.find(item => item.name === name)
    if (!this.destroyed && current?.generation === generation) { this.detailCache.set(key, value); return value }
    throw new Error('角色已重新投递，请重新打开完整信息')
  }

  destroy(): void {
    this.destroyed = true
    for (const timer of this.confirmationTimers.values()) this.clearTimer(timer)
    this.confirmationTimers.clear()
    this.client.destroy()
    this.confirmed.destroy()
    this.ui.destroy()
    this.detailCache.clear()
    this.subscribers.clear()
  }
}
