import type { CharacterResources, CharacterSummary, RuleSetId } from './room-v2-model'

/** The full export is retained, including fields unknown to this version of dhol. */
export type CharacterSheetJson = Record<string, unknown> & { ruleSetId: RuleSetId; name: string; hope: number }
export interface CharacterDelivery { schemaVersion: 1; sheet: CharacterSheetJson }

export function characterNameKey(name: string): string {
  const key = name.trim()
  if (!key || [...key].length > 80) throw new Error('INVALID_CHARACTER_NAME')
  return key
}

function display(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function attribute(value: unknown): string | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? display((value as Record<string, unknown>).value)
    : display(value)
}

export function resourcesFromSheet(sheet: CharacterSheetJson): CharacterResources {
  return {
    hope: sheet.hope,
    hopeMax: typeof sheet.hopeMax === 'number' ? sheet.hopeMax : 6,
    hp: Array.isArray(sheet.hp) ? [...sheet.hp] as boolean[] : [],
    stress: Array.isArray(sheet.stress) ? [...sheet.stress] as boolean[] : [],
    armor: Array.isArray(sheet.armorBoxes) ? [...sheet.armorBoxes] as boolean[] : [],
  }
}

export function summaryFromSheet(sheet: CharacterSheetJson, resources: CharacterResources, generation: number, position: number): CharacterSummary {
  return {
    name: characterNameKey(sheet.name), ruleSetId: sheet.ruleSetId, generation, position,
    resources, level: display(sheet.level), profession: display(sheet.profession),
    evasion: display(sheet.evasion), armorValue: display(sheet.armorValue),
    minorThreshold: display(sheet.minorThreshold), majorThreshold: display(sheet.majorThreshold),
    attributes: {
      agility: attribute(sheet.agility), strength: attribute(sheet.strength),
      finesse: attribute(sheet.finesse), instinct: attribute(sheet.instinct),
      presence: attribute(sheet.presence), knowledge: attribute(sheet.knowledge),
    },
    primaryWeaponDamage: display(sheet.primaryWeaponDamage),
    secondaryWeaponDamage: display(sheet.secondaryWeaponDamage),
  }
}

export interface StoredCharacter { roomId: string; name: string; generation: number; position: number; sheet: CharacterSheetJson; resources: CharacterResources }

/** Pure replacement model for the later SQL transaction; no shallow merge of old JSON. */
export function replaceCharacter(characters: StoredCharacter[], roomId: string, sheet: CharacterSheetJson, generation: number): StoredCharacter[] {
  const name = characterNameKey(sheet.name)
  const position = characters.find(character => character.roomId === roomId && character.name === name)?.position
    ?? Math.max(-1, ...characters.filter(character => character.roomId === roomId).map(character => character.position)) + 1
  const replacement: StoredCharacter = { roomId, name, generation, position, sheet: JSON.parse(JSON.stringify(sheet)) as CharacterSheetJson, resources: resourcesFromSheet(sheet) }
  return [...characters.filter(character => character.roomId !== roomId || character.name !== name), replacement]
}
