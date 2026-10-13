import { describe, expect, it } from 'vitest'
import { normalizeDiceRollRequest, rollDicePool } from '../dice'

function sequence(values: number[]) {
  let index = 0
  return () => values[index++] ?? 0
}

describe('normalizeDiceRollRequest', () => {
  it('merges matching dice and sorts the pool', () => {
    const request = normalizeDiceRollRequest({
      mode: 'standard',
      modifier_mode: 'normal',
      repeat: 1,
      modifier: 3,
      dice: [{ sides: 8, count: 2 }, { sides: 6, count: 1 }, { sides: 8, count: 1 }],
    })

    expect(request.dice).toEqual([{ sides: 6, count: 1 }, { sides: 8, count: 3 }])
  })

  it('rejects advantage on non-d20 pools', () => {
    expect(() => normalizeDiceRollRequest({
      mode: 'standard',
      modifier_mode: 'advantage',
      repeat: 1,
      modifier: 0,
      dice: [{ sides: 8, count: 2 }],
    })).toThrow('只有单枚 d20')
  })
})

describe('rollDicePool', () => {
  it('rolls d20 advantage, keeps the higher die, and detects a natural 20', () => {
    const rolled = rollDicePool({
      mode: 'standard',
      modifier_mode: 'advantage',
      repeat: 1,
      modifier: 2,
      dice: [{ sides: 20, count: 1 }],
    }, sequence([0.2, 0.999]))

    expect(rolled.results[0]).toMatchObject({
      primary_rolls: [5, 20],
      kept_primary: 20,
      total: 22,
      critical: true,
    })
  })

  it('rolls duality dice and adds an advantage d6 without changing the outcome comparison', () => {
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'advantage',
      repeat: 1,
      modifier: 2,
      dice: [],
    }, sequence([0.74, 0.24, 0.49]))

    expect(rolled.results[0]).toMatchObject({
      hope: 9,
      fear: 3,
      advantage_roll: 3,
      outcome: 'hope',
      total: 17,
      critical: false,
    })
  })

  it('rolls multiple advantage dice and adds only the highest d6', () => {
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'advantage',
      advantage_count: 3,
      repeat: 1,
      modifier: 2,
      dice: [],
    }, sequence([0.5, 0.25, 0, 0.999, 0.5]))

    expect(rolled.request.advantage_count).toBe(3)
    expect(rolled.results[0]).toMatchObject({
      hope: 7,
      fear: 4,
      advantage_rolls: [1, 6, 4],
      advantage_roll: 6,
      total: 19,
    })
  })

  it('subtracts only the highest d6 for multiple disadvantage dice', () => {
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'disadvantage',
      advantage_count: 2,
      repeat: 1,
      modifier: 0,
      dice: [],
    }, sequence([0, 0.5, 0.999, 0]))

    expect(rolled.results[0]).toMatchObject({ advantage_rolls: [6, 1], advantage_roll: 6, total: 2 })
  })

  it('rejects an out-of-range advantage count', () => {
    expect(() => normalizeDiceRollRequest({
      mode: 'dual', modifier_mode: 'advantage', advantage_count: 101,
      repeat: 1, modifier: 0, dice: [],
    })).toThrow('优劣势骰子数量')
  })

  it('uses an integer random source when one is available', () => {
    const integers = [11, 0]
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'normal',
      repeat: 1,
      modifier: 0,
      dice: [],
    }, {
      nextInt: (exclusiveMax) => {
        expect(exclusiveMax).toBe(12)
        return integers.shift() ?? 0
      },
      nextFloat: () => {
        throw new Error('nextFloat should not be used')
      },
    })

    expect(rolled.results[0]).toMatchObject({
      hope: 12,
      fear: 1,
      outcome: 'hope',
    })
  })

  it('marks matching duality dice as a critical success', () => {
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'disadvantage',
      repeat: 1,
      modifier: -2,
      dice: [],
    }, sequence([0.5, 0.5, 0]))

    expect(rolled.results[0]).toMatchObject({
      hope: 7,
      fear: 7,
      advantage_roll: 1,
      outcome: 'critical',
      total: 11,
      critical: true,
    })
  })

  it('sums every repeated roll into a single total, counting the modifier once', () => {
    const rolled = rollDicePool({
      mode: 'standard',
      modifier_mode: 'normal',
      repeat: 3,
      modifier: 2,
      dice: [{ sides: 6, count: 2 }],
    }, sequence([0, 0.5, 0.5, 0.999, 0.999, 0]))

    // 三次掷出 2d6：[1,4] [4,6] [6,1] → 骰子合计 22，再加固定加值 2
    expect(rolled.results).toHaveLength(1)
    expect(rolled.results[0]).toMatchObject({
      total: 24,
      critical: false,
      terms: [{ notation: '6d6', sides: 6, count: 6, subtotal: 22 }],
    })
    expect(rolled.results[0].terms[0].rolls).toEqual([1, 4, 4, 6, 6, 1])
  })

  it('merges repeated duality rolls and recomputes the outcome from the summed dice', () => {
    const rolled = rollDicePool({
      mode: 'dual',
      modifier_mode: 'normal',
      repeat: 2,
      modifier: 1,
      dice: [],
    }, sequence([0.74, 0.24, 0.1, 0.9]))

    // 两次匕首之心：希望 9+2=11，恐惧 3+11=14 → 恐惧结果，总计 11+14+1
    expect(rolled.results).toHaveLength(1)
    expect(rolled.results[0]).toMatchObject({
      hope: 11,
      fear: 14,
      outcome: 'fear',
      total: 26,
      critical: false,
    })
  })
})
