import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CharacterSummary } from '@dhgc/shared/desktop'
import { charactersOnPage, pageCount } from '../desktop/components/character-panel/pagination'
import CharacterSummaryCard from '../desktop/components/character-panel/CharacterSummaryCard'

function character(name: string, position: number): CharacterSummary {
  return { name, position, generation: position + 1, ruleSetId: 'daggerheart', resources: { hope: 1, hopeMax: 6, hp: [false], stress: [false], armor: [false] }, level: null, profession: null, evasion: null, armorValue: null, minorThreshold: null, majorThreshold: null, attributes: { agility: null, strength: null, finesse: null, instinct: null, presence: null, knowledge: null }, primaryWeaponName: null, primaryWeaponTrait: null, primaryWeaponRange: null, primaryWeaponDamage: null, secondaryWeaponName: null, secondaryWeaponTrait: null, secondaryWeaponRange: null, secondaryWeaponDamage: null }
}

describe('character panel pagination', () => {
  it('keeps a stable four-character page ordered by server position', () => {
    const characters = [character('五', 4), character('三', 2), character('一', 0), character('四', 3), character('二', 1)]
    expect(pageCount(characters.length)).toBe(2)
    expect(charactersOnPage(characters, 0).map(item => item.name)).toEqual(['一', '二', '三', '四'])
    expect(charactersOnPage(characters, 1).map(item => item.name)).toEqual(['五'])
  })
  it('shows weapon identity and six roll controls using the sheet values', () => {
    const item = character('阿岚', 0)
    item.attributes.agility = '+2'
    item.primaryWeaponName = '短弓'
    item.primaryWeaponTrait = '敏捷'
    item.primaryWeaponRange = '远距离'
    const html = renderToStaticMarkup(<CharacterSummaryCard character={item} ready onHope={() => undefined} onMark={() => undefined} onDetail={() => undefined} onDelete={() => undefined} onQuickRollStat={() => undefined} />)
    expect(html).toContain('阿岚 敏捷+2，掷二元骰')
    expect(html.match(/掷二元骰/g)).toHaveLength(6)
    expect(html).toContain('短弓')
    expect(html).toContain('敏捷 · 远距离')
    expect(html).not.toContain('主武器伤害')
  })
})
