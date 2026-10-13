import type { DiceRollRecord } from '@dhgc/shared/desktop'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import DicePanel from '../desktop/components/DicePanel'

it('shows a pending server roll without inventing a temporary result', () => {
  const html = renderToStaticMarkup(<DicePanel dice={[]} ready pending onRoll={vi.fn()} onClear={vi.fn()} />)
  expect(html).toContain('掷骰中')
  expect(html).not.toMatch(/>\d+<\/b>/)
})

it('renders 关键成功 verdict and hist-tag--crit badge for critical duality rolls', () => {
  const critRoll: DiceRollRecord = {
    id: 'crit-1',
    created_at: new Date().toISOString(),
    actor_player_id: 'p1',
    actor_name: 'Player One',
    normalized_formula: '2d12',
    request: { mode: 'dual', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [] },
    mode: 'dual',
    modifier_mode: 'normal',
    results: [
      {
        total: 20,
        critical: true,
        outcome: 'critical',
        hope: 10,
        fear: 10,
        primary_rolls: [10, 10],
        terms: [],
      },
    ],
  }

  const html = renderToStaticMarkup(<DicePanel dice={[critRoll]} ready pending={false} onRoll={vi.fn()} onClear={vi.fn()} />)
  expect(html).toContain('关键成功')
  expect(html).not.toContain('大成功')
  expect(html).toContain('hist-tag--crit')
})

it('shows rolled values in history without a redundant standard dice tag', () => {
  const roll: DiceRollRecord = {
    id: 'standard-1', created_at: new Date().toISOString(), actor_player_id: 'p1', actor_name: 'Player One',
    normalized_formula: '1d6 + 2d8 + 2',
    request: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 2, dice: [{ sides: 6, count: 1 }, { sides: 8, count: 2 }] },
    mode: 'standard', modifier_mode: 'normal',
    results: [{ total: 14, critical: false, primary_rolls: [], terms: [
      { notation: '1d6', sides: 6, count: 1, rolls: [3], subtotal: 3 },
      { notation: '2d8', sides: 8, count: 2, rolls: [4, 5], subtotal: 9 },
    ] }],
  }

  const html = renderToStaticMarkup(<DicePanel dice={[roll]} ready pending={false} onRoll={vi.fn()} onClear={vi.fn()} />)
  expect(html).toContain('1d6[3] + 2d8[4, 5] + 2')
  expect(html).not.toContain('class="hist-tag ')
})

