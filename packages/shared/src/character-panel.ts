import type { CharacterResources, CharacterSummary, RuleSetId } from './room-v2-model'

export const CHARACTER_ATTRIBUTES = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const
export type CharacterAttribute = typeof CHARACTER_ATTRIBUTES[number]

/** Values rendered by the builder at send time. The original sheet remains complete. */
export interface CharacterDesktopView {
  version: 1
  evasion: string
  armorValue: string
  minorThreshold: string
  majorThreshold: string
  attributes: Record<CharacterAttribute, string>
  hpMax: number
  stressMax: number
  armorMax: number
  primaryWeaponAttribute: string
  primaryWeaponRange: string
  secondaryWeaponAttribute: string
  secondaryWeaponRange: string
}

/** The full export is retained, including fields unknown to this version of dhol. */
export type CharacterSheetJson = Record<string, unknown> & { ruleSetId: RuleSetId; name: string; hope: number; desktopView?: CharacterDesktopView }
export type CharacterDelivery = { schemaVersion: 1; sheet: CharacterSheetJson } | { schemaVersion: 2; sheet: CharacterSheetJson & { desktopView: CharacterDesktopView } }

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

function cardIds(sheet: CharacterSheetJson): Set<string> {
  const cards = Array.isArray(sheet.cards) ? sheet.cards : []
  return new Set(cards.flatMap(card => card && typeof card === 'object' && 'id' in card && typeof card.id === 'string' ? [card.id] : []))
}

/** Match the character builder's displayed resource limits; its arrays can contain 18 storage slots. */
export function displayedResourceMax(sheet: CharacterSheetJson, resource: 'hp' | 'stress'): number {
  const sentMax = sheet.desktopView?.[`${resource}Max`]
  if (typeof sentMax === 'number') return sentMax
  const base = sheet[`${resource}Max`]
  const cards = cardIds(sheet)
  let bonus = 0
  if (resource === 'hp') {
    if (cards.has('Giant-Endurance')) bonus++
    if (cards.has('School-of-War-Foundation')) bonus++
  } else {
    if (cards.has('Human-HighStamina')) bonus++
    if (cards.has('Vengeance-Foundation')) bonus++
  }

  if (sheet.ruleSetId === 'rhodes-island') {
    const subclass = sheet.subclassRef
    const branch = subclass && typeof subclass === 'object' && 'id' in subclass && typeof subclass.id === 'string'
      ? subclass.id : Array.isArray(sheet.cards) && sheet.cards[1] && typeof sheet.cards[1] === 'object' && 'id' in sheet.cards[1] && typeof sheet.cards[1].id === 'string' ? sheet.cards[1].id : ''
    const level = Number.parseInt(String(sheet.level ?? '1'), 10) || 1
    const stage = level >= 5 ? 2 : level >= 2 ? 1 : 0
    if (resource === 'hp') {
      if (branch === 'ri-branch-e1682fc4bea1') bonus += 1 + (level >= 8 && sheet.selectedModule === 'y' ? 1 : 0)
      if (branch === 'ri-branch-f4162da267f0') bonus += [2, 2, 3][stage]
    } else {
      if (branch === 'ri-branch-dcb2660eeda4') bonus += [1, 2, 2][stage]
      if (branch === 'ri-branch-f4162da267f0') bonus += [1, 1, 3][stage]
      if (branch === 'ri-branch-b3775d66589c') bonus += [2, 2, 3][stage]
    }
  }
  return Math.max(0, (typeof base === 'number' ? base : 6) + bonus)
}

export function resourcesFromSheet(sheet: CharacterSheetJson): CharacterResources {
  const track = (marks: unknown, max: unknown): boolean[] => {
    if (!Array.isArray(marks)) return []
    return Array.from({ length: Math.min(100, typeof max === 'number' ? max : marks.length) }, (_, index) => Boolean(marks[index]))
  }
  return {
    hope: sheet.hope,
    hopeMax: typeof sheet.hopeMax === 'number' ? sheet.hopeMax : 6,
    hp: track(sheet.hp, displayedResourceMax(sheet, 'hp')),
    stress: track(sheet.stress, displayedResourceMax(sheet, 'stress')),
    armor: track(sheet.armorBoxes, sheet.desktopView?.armorMax ?? sheet.armorMax),
  }
}

export function summaryFromSheet(sheet: CharacterSheetJson, resources: CharacterResources, generation: number, position: number): CharacterSummary {
  const shownAttribute = (key: CharacterAttribute) => sheet.desktopView ? display(sheet.desktopView.attributes[key]) : attribute(sheet[key])
  return {
    name: characterNameKey(sheet.name), ruleSetId: sheet.ruleSetId, generation, position,
    resources, level: display(sheet.level), profession: display(sheet.profession),
    evasion: display(sheet.desktopView?.evasion ?? sheet.evasion), armorValue: display(sheet.desktopView?.armorValue ?? sheet.armorValue),
    minorThreshold: display(sheet.desktopView?.minorThreshold ?? sheet.minorThreshold), majorThreshold: display(sheet.desktopView?.majorThreshold ?? sheet.majorThreshold),
    attributes: {
      agility: shownAttribute('agility'), strength: shownAttribute('strength'),
      finesse: shownAttribute('finesse'), instinct: shownAttribute('instinct'),
      presence: shownAttribute('presence'), knowledge: shownAttribute('knowledge'),
    },
    primaryWeaponName: display(sheet.primaryWeaponName),
    primaryWeaponTrait: display(sheet.desktopView?.primaryWeaponAttribute ?? sheet.primaryWeaponTrait),
    primaryWeaponRange: display(sheet.desktopView?.primaryWeaponRange ?? sheet.primaryWeaponRange ?? sheet.primaryWeaponDistance),
    primaryWeaponDamage: display(sheet.primaryWeaponDamage),
    secondaryWeaponName: display(sheet.secondaryWeaponName),
    secondaryWeaponTrait: display(sheet.desktopView?.secondaryWeaponAttribute ?? sheet.secondaryWeaponTrait),
    secondaryWeaponRange: display(sheet.desktopView?.secondaryWeaponRange ?? sheet.secondaryWeaponRange ?? sheet.secondaryWeaponDistance),
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
