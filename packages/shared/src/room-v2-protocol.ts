import type { DiceRollRecord, DiceRollRequest } from './dice-types'
import { normalizeDiceRollRequest } from './dice'
import { characterNameKey } from './character-panel'
import type { CharacterResources, CharacterSummary, RoomMember, RoomV2Model, TrackResource } from './room-v2-model'

export const ROOM_V2_PROTOCOL_VERSION = 2 as const
export const ROOM_V2_SESSION_AUDIENCE = 'dhol-room-v2' as const
export interface MutationEnvelope { requestId: string; protocolVersion: 2 }
export interface CharacterIdentity { name: string; generation: number }
export type ResourceCommand = MutationEnvelope & CharacterIdentity & (
  | { type: 'character.adjustHope'; delta: 1 | -1 }
  | { type: 'character.setMark'; resource: TrackResource; index: number; marked: boolean }
)
export type RoomCommand = MutationEnvelope & (
  | { type: 'room.adjustFear'; delta: 1 | -1 }
  | { type: 'dice.roll'; payload: DiceRollRequest }
  | { type: 'dice.clearHistory' }
  | { type: 'xcard.set'; active: boolean }
  | { type: 'character.delete'; name: string; generation: number }
)
export type MutationCommand = ResourceCommand | RoomCommand
export interface SyncRequest { type: 'room.sync'; protocolVersion: 2; afterSeq: number; pendingRequestIds: string[] }
export interface MutationAck { type: 'operation.ack'; requestId: string; seq: number }
export interface MutationError {
  type: 'operation.error'; requestId: string
  code: 'INVALID_COMMAND' | 'CHARACTER_REPLACED' | 'REQUEST_ID_REUSED' | 'PERSISTENCE_FAILED' | 'ROOM_EXPIRED'
  message: string
}
type EventBase = { seq: number; requestId: string }
export type RoomEvent = EventBase & (
  | { type: 'character.replaced'; name: string; generation: number; summary: CharacterSummary }
  | { type: 'character.resourcesChanged'; name: string; generation: number; resources: CharacterResources }
  | { type: 'character.deleted'; name: string; generation: number }
  | { type: 'room.fearChanged'; fear: { value: number; max: number } }
  | { type: 'dice.rolled'; roll: DiceRollRecord }
  | { type: 'dice.historyCleared' }
  | { type: 'xcard.changed'; xCard: { active: boolean; updatedAt: string | null } }
)
export interface RoomSnapshot { type: 'room.snapshot'; protocolVersion: 2; room: RoomV2Model; receipts: MutationAck[] }
export interface RoomPresence { type: 'room.presence'; protocolVersion: 2; members: RoomMember[] }
export type RoomServerMessage = RoomSnapshot | RoomPresence | RoomEvent | MutationAck | MutationError

export function parseSyncRequest(value: unknown): SyncRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_COMMAND')
  const request = value as Record<string, unknown>
  if (request.type !== 'room.sync' || request.protocolVersion !== 2 || !Number.isSafeInteger(request.afterSeq) || (request.afterSeq as number) < 0 ||
    !Array.isArray(request.pendingRequestIds) || request.pendingRequestIds.length > 256 ||
    request.pendingRequestIds.some(id => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id))) throw new Error('INVALID_COMMAND')
  return request as unknown as SyncRequest
}

export function parseMutationCommand(value: unknown): MutationCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_COMMAND')
  const command = { ...value as Record<string, unknown> }
  if (command.protocolVersion !== 2 || typeof command.requestId !== 'string' || !/^[\w-]{1,128}$/.test(command.requestId)) throw new Error('INVALID_COMMAND')
  if (command.type === 'character.adjustHope' || command.type === 'character.setMark' || command.type === 'character.delete') {
    if (typeof command.name !== 'string' || !Number.isSafeInteger(command.generation) || (command.generation as number) < 1) throw new Error('INVALID_COMMAND')
    try { command.name = characterNameKey(command.name) } catch { throw new Error('INVALID_COMMAND') }
  }
  switch (command.type) {
    case 'character.adjustHope':
    case 'room.adjustFear':
      if (command.delta !== 1 && command.delta !== -1) break
      return command as unknown as MutationCommand
    case 'character.setMark':
      if (!['hp', 'stress', 'armor', 'gold'].includes(String(command.resource)) || !Number.isSafeInteger(command.index) || (command.index as number) < 0 || typeof command.marked !== 'boolean') break
      return command as unknown as MutationCommand
    case 'character.delete':
    case 'dice.clearHistory':
      return command as unknown as MutationCommand
    case 'xcard.set':
      if (typeof command.active === 'boolean') return command as unknown as MutationCommand
      break
    case 'dice.roll':
      if (command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload)) {
        const payload = command.payload as Record<string, unknown>
        if ((payload.mode !== 'standard' && payload.mode !== 'dual') || !['normal', 'advantage', 'disadvantage'].includes(String(payload.modifier_mode)) ||
          typeof payload.repeat !== 'number' || !Number.isInteger(payload.repeat) || typeof payload.modifier !== 'number' || !Number.isInteger(payload.modifier) || !Array.isArray(payload.dice)) break
        try { return { ...command, payload: normalizeDiceRollRequest(payload as unknown as DiceRollRequest) } as MutationCommand }
        catch { break }
      }
      break
  }
  throw new Error('INVALID_COMMAND')
}
