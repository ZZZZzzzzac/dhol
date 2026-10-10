import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReadOnlyCharacterSheet from '../desktop/components/character-panel/ReadOnlyCharacterSheet'
import { safeImageSource } from '../desktop/components/character-panel/sheet-utils'

describe('read-only character sheet', () => {
  it('renders long card text as escaped read-only content and current resources', () => {
    const html = renderToStaticMarkup(<ReadOnlyCharacterSheet sheet={{ ruleSetId: 'daggerheart', name: '阿岚', hope: 3, cards: [{ name: '能力', description: '<script>alert(1)</script>完整正文' }] }} resources={{ hope: 2, hopeMax: 6, hp: [true, false], stress: [false], armor: [true] }} />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;完整正文')
    expect(html).toContain('生命已标记')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('contenteditable')
  })
  it('rejects executable image schemes', () => {
    expect(safeImageSource('javascript:alert(1)')).toBeNull()
    expect(safeImageSource('https://example.com/a.png')).toBe('https://example.com/a.png')
  })
})
