import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReadOnlyCharacterSheet from '../desktop/components/character-panel/ReadOnlyCharacterSheet'
import { safeImageSource } from '../desktop/components/character-panel/sheet-utils'

describe('read-only character sheet', () => {
  it('renders long card text as escaped read-only content and current resources', () => {
    const html = renderToStaticMarkup(<ReadOnlyCharacterSheet sheet={{ ruleSetId: 'daggerheart', name: '阿岚', hope: 3, characterImage: 'data:image/jpeg;base64,SECRET', ancestry1: '人类', cards: [{ name: '能力', description: '<script>alert(1)</script>完整正文' }], adventureNotes: { characterProfile: { birthplace: '群山' }, backstory: '守护故乡。' } }} resources={{ hope: 2, hopeMax: 6, hp: [true, false], stress: [false], armor: [true] }} />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;完整正文')
    expect(html).toContain('生命已标记')
    expect(html).toContain('种族')
    expect(html).toContain('出生地')
    expect(html).toContain('守护故乡。')
    expect(html).not.toContain('characterImage')
    expect(html).not.toContain('base64')
    expect(html).not.toContain('<pre')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('contenteditable')
  })
  it('rejects executable image schemes', () => {
    expect(safeImageSource('javascript:alert(1)')).toBeNull()
    expect(safeImageSource('https://example.com/a.png')).toBe('https://example.com/a.png')
  })
  it('shows the sent threshold and all edited source text in the read-only detail', () => {
    const html = renderToStaticMarkup(<ReadOnlyCharacterSheet sheet={{
      ruleSetId: 'daggerheart', name: '阿岚', hope: 3, cards: [], minorThreshold: '9', characterBackground: '刚修改的背景',
      customNotes: { title: '手写标题', lines: ['第一句'] },
      desktopView: { version: 1, evasion: '11', armorValue: '2', minorThreshold: '17', majorThreshold: '28',
        attributes: { agility: '+2', strength: '+1', finesse: '0', instinct: '0', presence: '0', knowledge: '0' },
        hpMax: 7, stressMax: 7, armorMax: 2, primaryWeaponAttribute: '', primaryWeaponRange: '', secondaryWeaponAttribute: '', secondaryWeaponRange: '' },
    }} resources={{ hope: 3, hopeMax: 6, hp: Array(7).fill(false), stress: Array(7).fill(false), armor: [false, false] }} />)
    expect(html).toContain('<dd>17</dd>')
    expect(html).toContain('刚修改的背景')
    expect(html).toContain('手写标题')
    expect(html).toContain('第一句')
    expect(html).toContain('完整角色字段')
  })
})
