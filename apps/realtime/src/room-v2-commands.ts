import { characterNameKey, resourcesFromSheet, rollDicePool, summaryFromSheet, type CharacterSheetJson, type DiceRollRecord, type MutationAck, type MutationCommand, type MutationError, type RoomEvent } from '@dhgc/shared/desktop'
import { isExpired, RoomV2Storage } from './room-v2-storage'
import { summarizeRollServerMetrics, type RollCommandMetric } from './room-v2-metrics'

export type { RollCommandMetric } from './room-v2-metrics'

export class CommandFailure extends Error {
  constructor(readonly code: MutationError['code'], message: string) { super(message) }
}

export interface CommitResult { ack: MutationAck; event: RoomEvent | null; duplicate: boolean; action?: 'created' | 'updated' }
export type CommandStorage = Pick<RoomV2Storage, 'receipt' | 'metaRow' | 'roomExpiresAt' | 'characterHeader' | 'resources' | 'nextPosition' | 'transaction' | 'advance' | 'saveReceipt' | 'saveResources' | 'saveCharacter' | 'deleteCharacter' | 'saveDice' | 'clearDice'>
export interface RoomV2CommandOptions {
  now?: () => number
  hash?: (value: unknown) => Promise<string>
  onRollMetric?: (metric: RollCommandMetric) => void
}
export interface CommandTimingContext { receivedAtMs: number }
interface CommitTimingHooks { transactionStarted(): void; transactionCommitted(): void; broadcastCompleted(): void }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function randomInt(max: number): number {
  const value = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / max) * max
  do { crypto.getRandomValues(value) } while (value[0] >= limit)
  return value[0] % max
}

export class RoomV2Commands {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  private readonly hash: (value: unknown) => Promise<string>
  constructor(private readonly db: CommandStorage, private readonly publish: (event: RoomEvent) => void, private readonly options: RoomV2CommandOptions = {}) {
    this.now = options.now ?? (() => performance.now())
    this.hash = options.hash ?? payloadHash
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  async mutate(actor: string, nickname: string, command: MutationCommand, timing?: CommandTimingContext): Promise<CommitResult> {
    const receivedAtMs = timing?.receivedAtMs ?? this.now()
    const enqueuedAtMs = this.now()
    return this.enqueue(async () => {
      const dequeuedAtMs = this.now()
      const hash = await this.hash(command)
      const hashedAtMs = this.now()
      let transactionStartedAtMs = hashedAtMs
      let transactionCommittedAtMs = hashedAtMs
      let broadcastAtMs = hashedAtMs
      const result = this.commit(actor, command.requestId, hash, this.applyCommand(actor, nickname, command), {
        transactionStarted: () => { transactionStartedAtMs = this.now() },
        transactionCommitted: () => { transactionCommittedAtMs = this.now() },
        broadcastCompleted: () => { broadcastAtMs = this.now() },
      })
      if (command.type === 'dice.roll' && !result.duplicate && result.event?.type === 'dice.rolled') {
        const eventBytes = new TextEncoder().encode(JSON.stringify(result.event)).byteLength
        this.options.onRollMetric?.(summarizeRollServerMetrics({
          requestId: command.requestId, receivedAtMs, enqueuedAtMs, dequeuedAtMs, hashedAtMs,
          transactionStartedAtMs, transactionCommittedAtMs, broadcastAtMs,
        }, eventBytes))
      }
      return result
    })
  }

  async replace(actor: string, requestId: string, sheet: CharacterSheetJson): Promise<CommitResult> {
    const name = characterNameKey(sheet.name)
    return this.enqueue(async () => {
      const hash = await this.hash({ type: 'character.replace', sheet })
      return this.commit(actor, requestId, hash, seq => {
        const previous = this.db.characterHeader(name)
        const position = previous?.position ?? this.db.nextPosition()
        const resources = resourcesFromSheet(sheet)
        const summary = summaryFromSheet(sheet, resources, seq, position)
        const event: RoomEvent = { type: 'character.replaced', requestId, seq, name, generation: seq, summary }
        return { event, write: () => this.db.saveCharacter(name, seq, position, sheet, summary, resources), action: previous ? 'updated' as const : 'created' as const }
      })
    })
  }

  private commit(actor: string, requestId: string, hash: string, build: (seq: number) => { event: RoomEvent | null; write: () => void; action?: 'created' | 'updated' }, timing?: CommitTimingHooks): CommitResult {
    const prior = this.db.receipt(actor, requestId)
    if (prior) {
      if (prior.payload_hash !== hash) throw new CommandFailure('REQUEST_ID_REUSED', '请求 ID 已用于另一操作')
      const result = JSON.parse(prior.result_json) as CommitResult
      return { ...result, duplicate: true, event: null }
    }
    const meta = this.db.metaRow()
    const expiresAt = this.db.roomExpiresAt()
    if (!meta || isExpired(expiresAt)) throw new CommandFailure('ROOM_EXPIRED', '房间已过期')
    const seq = meta.seq + 1
    const change = build(seq)
    const ack: MutationAck = { type: 'operation.ack', requestId, seq: change.event ? seq : meta.seq }
    const result: CommitResult = { ack, event: change.event, duplicate: false, action: change.action }
    try {
      timing?.transactionStarted()
      this.db.transaction(() => {
        change.write()
        if (change.event) this.db.advance(seq, change.event.type === 'room.fearChanged' ? change.event.fear.value : undefined, change.event.type === 'xcard.changed' ? change.event.xCard : undefined)
        this.db.saveReceipt(actor, requestId, hash, ack.seq, result)
      })
      timing?.transactionCommitted()
    } catch {
      throw new CommandFailure('PERSISTENCE_FAILED', '保存失败，请重试')
    }
    if (change.event) this.publish(change.event)
    timing?.broadcastCompleted()
    return result
  }

  private applyCommand(actor: string, nickname: string, command: MutationCommand): (seq: number) => { event: RoomEvent | null; write: () => void } {
    return seq => {
      const requestId = command.requestId
      if (command.type === 'character.adjustHope' || command.type === 'character.setMark' || command.type === 'character.delete') {
        const row = this.db.characterHeader(command.name)
        if (!row || row.generation !== command.generation) throw new CommandFailure('CHARACTER_REPLACED', '角色已重新投递，旧修改未应用')
        if (command.type === 'character.delete') return { event: { type: 'character.deleted', requestId, seq, name: command.name, generation: command.generation }, write: () => this.db.deleteCharacter(command.name) }
        const previous = this.db.resources(command.name)!
        const resources = { ...previous }
        if (command.type === 'character.adjustHope') {
          resources.hope = Math.max(0, Math.min(previous.hopeMax, previous.hope + command.delta))
          if (resources.hope === previous.hope) return { event: null, write: () => undefined }
        } else {
          const track = previous[command.resource]
          if (command.index >= track.length) throw new CommandFailure('INVALID_COMMAND', '资源格索引无效')
          if (track[command.index] === command.marked) return { event: null, write: () => undefined }
          resources[command.resource] = track.map((mark, index) => index === command.index ? command.marked : mark)
        }
        return { event: { type: 'character.resourcesChanged', requestId, seq, name: command.name, generation: command.generation, resources }, write: () => this.db.saveResources(command.name, resources) }
      }
      const meta = this.db.metaRow()!
      if (command.type === 'room.adjustFear') {
        const value = Math.max(0, Math.min(12, meta.fear + command.delta))
        return value === meta.fear ? { event: null, write: () => undefined } : { event: { type: 'room.fearChanged', requestId, seq, fear: { value, max: 12 } }, write: () => undefined }
      }
      if (command.type === 'xcard.set') {
        const previous = meta.xcard_json ? JSON.parse(meta.xcard_json) as { active: boolean } : { active: false }
        if (previous.active === command.active) return { event: null, write: () => undefined }
        return { event: { type: 'xcard.changed', requestId, seq, xCard: { active: command.active, updatedAt: new Date().toISOString() } }, write: () => undefined }
      }
      if (command.type === 'dice.clearHistory') {
        return { event: { type: 'dice.historyCleared', requestId, seq }, write: () => this.db.clearDice() }
      }
      const rolled = rollDicePool(command.payload, { nextInt: randomInt })
      const roll: DiceRollRecord = {
        id: crypto.randomUUID(), created_at: new Date().toISOString(), actor_player_id: actor, actor_name: nickname,
        normalized_formula: rolled.normalizedFormula, request: rolled.request, mode: rolled.request.mode,
        modifier_mode: rolled.request.modifier_mode, results: rolled.results,
      }
      return { event: { type: 'dice.rolled', requestId, seq, roll }, write: () => this.db.saveDice(seq, roll) }
    }
  }
}
