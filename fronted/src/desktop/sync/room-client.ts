import type { MutationCommand, RoomServerMessage, SyncRequest } from '@dhgc/shared/desktop'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'synchronizing' | 'ready' | 'reconnecting' | 'expired'
export type RoomSocket = Pick<WebSocket, 'readyState' | 'onopen' | 'onmessage' | 'onclose' | 'onerror' | 'send' | 'close'>
export interface RoomClientOptions {
  roomId: string
  websocketUrl: string
  socketFactory?: (url: string) => RoomSocket
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  visibilityTarget?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  pendingIds: () => string[]
  afterSeq: () => number
  onMessage: (message: RoomServerMessage) => void
  onStatus: (status: ConnectionStatus, reason?: string) => void
}

export class RoomClient {
  private socket: RoomSocket | null = null
  private status: ConnectionStatus = 'disconnected'
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private destroyed = false
  private readonly factory: (url: string) => RoomSocket
  private readonly setTimer: NonNullable<RoomClientOptions['setTimer']>
  private readonly clearTimer: NonNullable<RoomClientOptions['clearTimer']>
  private readonly options: RoomClientOptions
  constructor(options: RoomClientOptions) {
    this.options = options
    this.factory = options.socketFactory ?? (url => new WebSocket(url))
    this.setTimer = options.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms))
    this.clearTimer = options.clearTimer ?? (handle => globalThis.clearTimeout(handle))
    options.visibilityTarget?.addEventListener('visibilitychange', this.onVisibility)
  }
  get connectionStatus(): ConnectionStatus { return this.status }
  private update(status: ConnectionStatus, reason?: string): void {
    this.status = status
    this.options.onStatus(status, reason)
  }
  connect(): void {
    if (this.destroyed || this.socket || this.status === 'expired') return
    this.update(this.attempt ? 'reconnecting' : 'connecting')
    const socket = this.factory(this.options.websocketUrl)
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket || this.destroyed) return
      this.update('synchronizing')
      this.sync()
    }
    socket.onmessage = event => {
      if (this.socket !== socket || this.destroyed) return
      try { this.options.onMessage(JSON.parse(event.data) as RoomServerMessage) }
      catch { this.update('synchronizing', '服务器消息无效'); this.sync() }
    }
    socket.onclose = event => {
      if (this.socket !== socket || this.destroyed) return
      this.socket = null
      if (event.code === 1008 || /expired|retired/i.test(event.reason)) { this.update('expired', event.reason); return }
      this.update('reconnecting', event.reason || '连接中断')
      this.scheduleReconnect()
    }
    socket.onerror = () => { if (this.socket === socket) this.update('reconnecting', '网络连接失败') }
  }
  private scheduleReconnect(): void {
    if (this.retryTimer || this.destroyed) return
    const delay = Math.min(10_000, 500 * 2 ** Math.min(5, this.attempt++))
    this.retryTimer = this.setTimer(() => { this.retryTimer = null; this.connect() }, delay)
  }
  sync(): void {
    if (!this.socket || this.socket.readyState !== 1 || this.destroyed) return
    this.update('synchronizing')
    const request: SyncRequest = { type: 'room.sync', protocolVersion: 2, afterSeq: this.options.afterSeq(), pendingRequestIds: this.options.pendingIds() }
    this.socket.send(JSON.stringify(request))
  }
  ready(): void {
    if (this.destroyed || !this.socket || this.socket.readyState !== 1) return
    this.attempt = 0
    this.update('ready')
  }
  send(command: MutationCommand): boolean {
    if (this.status !== 'ready' || !this.socket || this.socket.readyState !== 1) return false
    this.socket.send(JSON.stringify(command))
    return true
  }
  private onVisibility = (): void => {
    if (this.options.visibilityTarget?.visibilityState === 'visible' && this.status === 'ready') this.sync()
  }
  destroy(): void {
    this.destroyed = true
    this.options.visibilityTarget?.removeEventListener('visibilitychange', this.onVisibility)
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = null
    const socket = this.socket
    this.socket = null
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(1000, 'Room changed') }
    this.update('disconnected')
  }
}
