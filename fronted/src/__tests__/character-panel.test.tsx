import { describe, expect, it } from 'vitest'
import type { CharacterSummary } from '@dhgc/shared/desktop'
import { charactersOnPage, pageCount } from '../desktop/components/character-panel/pagination'

function character(name: string, position: number): CharacterSummary {
  return { name, position, generation: position + 1, ruleSetId: 'daggerheart', resources: { hope: 1, hopeMax: 6, hp: [false], stress: [false], armor: [false] }, level: null, profession: null, evasion: null, armorValue: null, minorThreshold: null, majorThreshold: null, attributes: { agility: null, strength: null, finesse: null, instinct: null, presence: null, knowledge: null }, primaryWeaponDamage: null, secondaryWeaponDamage: null }
}

describe('character panel pagination', () => {
  it('keeps a stable four-character page ordered by server position', () => {
    const characters = [character('五', 4), character('三', 2), character('一', 0), character('四', 3), character('二', 1)]
    expect(pageCount(characters.length)).toBe(2)
    expect(charactersOnPage(characters, 0).map(item => item.name)).toEqual(['一', '二', '三', '四'])
    expect(charactersOnPage(characters, 1).map(item => item.name)).toEqual(['五'])
  })
})
