import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import DicePanel from '../desktop/components/DicePanel'

it('shows a pending server roll without inventing a temporary result', () => {
  const html = renderToStaticMarkup(<DicePanel dice={[]} ready pending onRoll={vi.fn()} onClear={vi.fn()} />)
  expect(html).toContain('掷骰中')
  expect(html).not.toMatch(/>\d+<\/b>/)
})
