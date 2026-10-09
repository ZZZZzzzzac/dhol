import { characterNameKey, type CharacterDelivery, type CharacterSheetJson } from './character-panel'
import type { RuleSetId } from './room-v2-model'

export const MAX_CHARACTER_JSON_BYTES = 512 * 1024
export const MAX_CHARACTER_REQUEST_BYTES = 544 * 1024
const MAX_TRACK_LENGTH = 100
const RULE_SETS: ReadonlySet<string> = new Set<RuleSetId>(['daggerheart', 'rhodes-island'])

export class CharacterValidationError extends Error {
  constructor(public readonly code: 'INVALID_CHARACTER' | 'UNSUPPORTED_SCHEMA' | 'PAYLOAD_TOO_LARGE', message: string) {
    super(message)
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function track(value: unknown, label: string): asserts value is boolean[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRACK_LENGTH || value.some(mark => typeof mark !== 'boolean')) {
    throw new CharacterValidationError('INVALID_CHARACTER', `${label} 必须是 1 至 ${MAX_TRACK_LENGTH} 个布尔值`)
  }
}

function boundedInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new CharacterValidationError('INVALID_CHARACTER', `${label} 超出范围`)
  }
}

export function validateCharacterDelivery(value: unknown): CharacterDelivery {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.sheet)) {
    throw new CharacterValidationError('UNSUPPORTED_SCHEMA', '只接受 schemaVersion 1 的角色 JSON')
  }
  const sheet = value.sheet
  if (typeof sheet.ruleSetId !== 'string' || !RULE_SETS.has(sheet.ruleSetId)) {
    throw new CharacterValidationError('INVALID_CHARACTER', '不支持的规则')
  }
  if (typeof sheet.name !== 'string') throw new CharacterValidationError('INVALID_CHARACTER', '角色名无效')
  try { characterNameKey(sheet.name) } catch { throw new CharacterValidationError('INVALID_CHARACTER', '角色名无效') }
  const hopeMax = sheet.hopeMax === undefined ? 6 : sheet.hopeMax
  boundedInteger(hopeMax, 1, 12, '希望上限')
  boundedInteger(sheet.hope, 0, hopeMax, '希望')
  track(sheet.hp, '生命')
  track(sheet.stress, '压力')
  track(sheet.armorBoxes, '护甲槽')
  for (const [key, length] of [['hpMax', sheet.hp.length], ['stressMax', sheet.stress.length], ['armorMax', sheet.armorBoxes.length]] as const) {
    if (sheet[key] !== undefined) boundedInteger(sheet[key], key === 'armorMax' ? 0 : 1, length, key)
  }
  if (!Array.isArray(sheet.cards) || (sheet.inventory_cards !== undefined && !Array.isArray(sheet.inventory_cards))) {
    throw new CharacterValidationError('INVALID_CHARACTER', '卡牌字段必须是数组')
  }
  const sheetJson = JSON.stringify(sheet)
  if (new TextEncoder().encode(sheetJson).byteLength > MAX_CHARACTER_JSON_BYTES) {
    throw new CharacterValidationError('PAYLOAD_TOO_LARGE', '角色 JSON 超过 512 KiB')
  }
  return { schemaVersion: 1, sheet: sheet as CharacterSheetJson }
}

/** Call at the HTTP boundary before any room mutation. */
export function parseCharacterDelivery(body: string): CharacterDelivery {
  if (new TextEncoder().encode(body).byteLength > MAX_CHARACTER_REQUEST_BYTES) {
    throw new CharacterValidationError('PAYLOAD_TOO_LARGE', '请求超过 544 KiB')
  }
  let value: unknown
  try { value = JSON.parse(body) } catch { throw new CharacterValidationError('INVALID_CHARACTER', '无效 JSON') }
  return validateCharacterDelivery(value)
}
