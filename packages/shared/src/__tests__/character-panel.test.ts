import { describe, expect, it } from 'vitest'
import daggerheart from './fixtures/daggerheart-sheet.json'
import rhodes from './fixtures/rhodes-sheet.json'
import { characterNameKey, displayedResourceMax, replaceCharacter, resourcesFromSheet, summaryFromSheet, type CharacterSheetJson } from '../character-panel'
import { parseCharacterDelivery } from '../room-v2-validation'

const dagger = daggerheart as CharacterSheetJson
const island = rhodes as CharacterSheetJson
const deliver = (sheet: unknown) => JSON.stringify({ schemaVersion: 1, sheet })

describe('character identity', () => {
  it('trims only the edges, keeping case and interior spaces', () => {
    expect(characterNameKey(' 阿岚 ')).toBe('阿岚')
    expect(characterNameKey('A B')).toBe('A B')
    expect(characterNameKey('Aran')).not.toBe(characterNameKey('aran'))
  })
  it('rejects empty and overlong names', () => {
    expect(() => characterNameKey('   ')).toThrow('INVALID_CHARACTER_NAME')
    expect(() => characterNameKey('界'.repeat(81))).toThrow('INVALID_CHARACTER_NAME')
  })
})

describe('JSON delivery', () => {
  it.each([dagger, island])('preserves a full %s sheet and its boolean resources', sheet => {
    const received = parseCharacterDelivery(deliver(sheet)).sheet
    expect(received).toEqual(sheet)
    expect(resourcesFromSheet(received)).toEqual({ hope: sheet.hope, hopeMax: sheet.hopeMax, hp: sheet.hp, stress: sheet.stress, armor: sheet.armorBoxes })
    expect(summaryFromSheet(received, resourcesFromSheet(received), 3, 0).attributes.agility).toBeTruthy()
  })
  it('replaces all data and resources while preserving position', () => {
    const first = replaceCharacter([], 'room-a', dagger, 2)
    const modified = { ...dagger, name: ' 阿岚 ', hope: 1, stress: dagger.stress.map(() => false), primaryWeaponName: undefined, primaryWeaponDamage: undefined }
    const replaced = replaceCharacter(first, 'room-a', modified, 8)
    expect(replaced).toHaveLength(1)
    expect(replaced[0].position).toBe(0)
    expect(replaced[0].resources.hope).toBe(1)
    expect(replaced[0].resources.stress.every(mark => !mark)).toBe(true)
    expect(replaced[0].sheet).not.toHaveProperty('primaryWeaponName')
    expect(replaced[0].sheet).not.toHaveProperty('primaryWeaponDamage')
    expect(replaceCharacter(replaced, 'room-a', island, 9)).toHaveLength(2)
    expect(replaceCharacter(replaced, 'room-b', dagger, 2)).toHaveLength(2)
    expect(replaceCharacter([{ ...replaced[0], position: 3 }], 'room-a', island, 9)[1].position).toBe(4)
  })
  it('uses displayed maxima rather than padded track array lengths', () => {
    const sheet = { ...dagger, hp: Array(18).fill(false), hpMax: 7, stress: Array(18).fill(false), stressMax: 7, armorBoxes: Array(12).fill(false), armorMax: 2 }
    const resources = resourcesFromSheet(sheet)
    expect(resources.hp).toHaveLength(7)
    expect(resources.stress).toHaveLength(7)
    expect(resources.armor).toHaveLength(2)
  })
  it('includes the character builder’s permanent card bonus in displayed stress', () => {
    const sheet = { ...dagger, hp: Array(18).fill(false), hpMax: 7, stress: Array(18).fill(false), stressMax: 6,
      cards: [{ id: 'Human-HighStamina' }] }
    expect(displayedResourceMax(sheet, 'hp')).toBe(7)
    expect(displayedResourceMax(sheet, 'stress')).toBe(7)
    expect(resourcesFromSheet(sheet).hp).toHaveLength(7)
    expect(resourcesFromSheet(sheet).stress).toHaveLength(7)
  })
  it('pairs only named experiences with their matching bonuses, including ancestry experience', () => {
    const sheet = { ...dagger,
      experience: ['身经百战', '', '走遍大陆', '未填加值'], experienceValues: ['2', '9', '+3', ''],
      ancestryExperience: ['旧城居民'], ancestryExperienceValues: ['2'],
    }
    expect(summaryFromSheet(sheet, resourcesFromSheet(sheet), 1, 0).experiences).toEqual([
      { name: '旧城居民', bonus: '+2', kind: 'ancestry' },
      { name: '身经百战', bonus: '+2', kind: 'standard' },
      { name: '走遍大陆', bonus: '+3', kind: 'standard' },
      { name: '未填加值', bonus: null, kind: 'standard' },
    ])
  })
  it('uses the builder display snapshot while preserving every edited source field on replacement', () => {
    const desktopView = {
      version: 1, evasion: '12', armorValue: '3', minorThreshold: '17', majorThreshold: '28',
      attributes: { agility: '+3', strength: '+1', finesse: '0', instinct: '+2', presence: '-1', knowledge: '0' },
      hpMax: 7, stressMax: 7, armorMax: 3,
      primaryWeaponAttribute: '敏捷', primaryWeaponRange: '远距离', secondaryWeaponAttribute: '', secondaryWeaponRange: '',
    }
    const edited = { ...dagger, name: '阿岚', hp: Array(18).fill(false), stress: Array(18).fill(false),
      minorThreshold: '9', minorThresholdManualModifier: '8', characterBackground: '发送前编辑的背景', desktopView }
    const parsed = parseCharacterDelivery(JSON.stringify({ schemaVersion: 2, sheet: edited })).sheet
    const replaced = replaceCharacter(replaceCharacter([], 'room-a', dagger, 1), 'room-a', parsed, 2)
    expect(replaced[0].sheet).toEqual(edited)
    expect(replaced[0].resources.hp).toHaveLength(7)
    expect(replaced[0].resources.stress).toHaveLength(7)
    expect(summaryFromSheet(parsed, replaced[0].resources, 2, 0)).toMatchObject({ minorThreshold: '17', attributes: { agility: '+3' }, primaryWeaponRange: '远距离' })
  })
  it.each([
    [deliver({ ...dagger, name: ' ' }), 'INVALID_CHARACTER'],
    [deliver({ ...dagger, ruleSetId: 'other' }), 'INVALID_CHARACTER'],
    [deliver({ ...dagger, hp: [0] }), 'INVALID_CHARACTER'],
    [deliver({ ...dagger, hope: 99 }), 'INVALID_CHARACTER'],
    [deliver({ ...dagger, cards: {} }), 'INVALID_CHARACTER'],
    [JSON.stringify({ schemaVersion: 2, sheet: dagger }), 'INVALID_CHARACTER'],
    [deliver({ ...dagger, desktopView: { version: 1 } }), 'INVALID_CHARACTER'],
    [JSON.stringify({ schemaVersion: 3, sheet: dagger }), 'UNSUPPORTED_SCHEMA'],
    [deliver({ ...dagger, unknown: 'x'.repeat(513 * 1024) }), 'PAYLOAD_TOO_LARGE'],
    ['x'.repeat(545 * 1024), 'PAYLOAD_TOO_LARGE'],
  ])('rejects malformed delivery (%s)', (body, code) => {
    expect(() => parseCharacterDelivery(body)).toThrowError(expect.objectContaining({ code }))
  })
})
