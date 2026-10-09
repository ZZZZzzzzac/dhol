import type {
  DiceModifierMode,
  DicePoolEntry,
  DiceRollRequest,
  DiceRollResult,
  DiceTermRoll,
} from './dice-types'

const ALLOWED_DICE = new Set([4, 6, 8, 10, 12, 20, 100])
const MAX_REPEAT = 20
const MAX_DICE_PER_TYPE = 100
const MAX_MODIFIER = 100_000

export interface RolledDicePool {
  request: DiceRollRequest
  normalizedFormula: string
  results: DiceRollResult[]
}

export type DiceRandomSource = (() => number) | {
  nextFloat?: () => number
  nextInt?: (exclusiveMax: number) => number
}

export function normalizeDiceRollRequest(input: DiceRollRequest): DiceRollRequest {
  const mode = input?.mode === 'dual' ? 'dual' : 'standard'
  const repeat = boundedInteger(input?.repeat, 1, MAX_REPEAT, '重复次数')
  const modifier = boundedInteger(input?.modifier, -MAX_MODIFIER, MAX_MODIFIER, '固定加值')
  const modifierMode = normalizeModifierMode(input?.modifier_mode)
  const dice = normalizeDicePool(input?.dice)

  if (mode === 'standard' && dice.length === 0) {
    throw new Error('请至少选择一枚骰子')
  }

  if (modifierMode !== 'normal') {
    const isSingleD20 = mode === 'standard'
      && dice.length === 1
      && dice[0].sides === 20
      && dice[0].count === 1
    if (mode !== 'dual' && !isSingleD20) {
      throw new Error('只有单枚 d20 和匕首之心二元骰支持优势或劣势')
    }
  }

  return {
    mode,
    modifier_mode: modifierMode,
    repeat,
    modifier,
    dice,
  }
}

export function rollDicePool(input: DiceRollRequest, random: DiceRandomSource = Math.random): RolledDicePool {
  const request = normalizeDiceRollRequest(input)
  const rolls = Array.from({ length: request.repeat }, () => (
    request.mode === 'dual' ? rollDual(request, random) : rollStandard(request, random)
  ))
  return {
    request,
    normalizedFormula: formatDiceFormula(request),
    results: request.repeat > 1 ? [aggregateRolls(rolls, request)] : rolls,
  }
}

// 重复次数：把整个骰池掷出对应次数，全部骰子相加成一个总结果。固定加值只计一次。
function aggregateRolls(rolls: DiceRollResult[], request: DiceRollRequest): DiceRollResult {
  const modifier = request.modifier
  const total = rolls.reduce((sum, roll) => sum + roll.total, 0) - modifier * (rolls.length - 1)
  const terms = mergeTerms(rolls)
  const primaryRolls = rolls.flatMap((roll) => roll.primary_rolls)

  if (request.mode === 'dual') {
    const hope = rolls.reduce((sum, roll) => sum + (roll.hope ?? 0), 0)
    const fear = rolls.reduce((sum, roll) => sum + (roll.fear ?? 0), 0)
    const advantageRolls = rolls.filter((roll) => roll.advantage_roll !== undefined)
    const advantageRoll = advantageRolls.length
      ? advantageRolls.reduce((sum, roll) => sum + (roll.advantage_roll ?? 0), 0)
      : undefined
    const outcome = hope === fear ? 'critical' : hope > fear ? 'hope' : 'fear'
    return {
      total,
      critical: outcome === 'critical',
      outcome,
      hope,
      fear,
      primary_rolls: primaryRolls,
      advantage_roll: advantageRoll,
      terms,
    }
  }

  return {
    total,
    critical: rolls.some((roll) => roll.critical),
    primary_rolls: primaryRolls,
    terms,
  }
}

function mergeTerms(rolls: DiceRollResult[]): DiceTermRoll[] {
  const bySides = new Map<number, DiceTermRoll>()
  for (const roll of rolls) {
    for (const term of roll.terms) {
      const existing = bySides.get(term.sides)
      if (existing) {
        existing.count += term.count
        existing.rolls.push(...term.rolls)
        existing.subtotal += term.subtotal
        existing.notation = `${existing.count}d${term.sides}`
      } else {
        bySides.set(term.sides, { ...term, rolls: [...term.rolls] })
      }
    }
  }
  return Array.from(bySides.values()).sort((left, right) => left.sides - right.sides)
}

export function formatDiceFormula(request: DiceRollRequest): string {
  const base = request.mode === 'dual'
    ? '希望 d12 + 恐惧 d12'
    : request.dice.map((entry) => `${entry.count}d${entry.sides}`).join(' + ')
  const bonusDice = request.mode === 'dual' && request.dice.length
    ? ` + ${request.dice.map((entry) => `${entry.count}d${entry.sides}`).join(' + ')}`
    : ''
  const modifier = request.modifier > 0
    ? ` + ${request.modifier}`
    : request.modifier < 0 ? ` - ${Math.abs(request.modifier)}` : ''
  const advantage = request.modifier_mode === 'advantage'
    ? ' 优势'
    : request.modifier_mode === 'disadvantage' ? ' 劣势' : ''
  const formula = `${base}${bonusDice}${modifier}${advantage}`
  return request.repeat > 1 ? `${request.repeat} 次合计：${formula}` : formula
}

function rollStandard(request: DiceRollRequest, random: DiceRandomSource): DiceRollResult {
  const isD20Check = request.dice.length === 1
    && request.dice[0].sides === 20
    && request.dice[0].count === 1

  if (isD20Check && request.modifier_mode !== 'normal') {
    const rolls = rollMany(2, 20, random)
    const keptPrimary = request.modifier_mode === 'advantage'
      ? Math.max(...rolls)
      : Math.min(...rolls)
    return {
      total: keptPrimary + request.modifier,
      critical: keptPrimary === 20,
      primary_rolls: rolls,
      kept_primary: keptPrimary,
      terms: [{
        notation: '1d20',
        sides: 20,
        count: 1,
        rolls,
        subtotal: keptPrimary,
      }],
    }
  }

  const terms = request.dice.map((entry) => rollPoolEntry(entry, random))
  const d20Term = terms.find((term) => term.sides === 20 && term.count === 1)
  return {
    total: terms.reduce((sum, term) => sum + term.subtotal, request.modifier),
    critical: Boolean(d20Term?.rolls.includes(20)),
    primary_rolls: d20Term?.rolls ?? [],
    terms,
  }
}

function rollDual(request: DiceRollRequest, random: DiceRandomSource): DiceRollResult {
  const hope = rollDie(12, random)
  const fear = rollDie(12, random)
  const advantageRoll = request.modifier_mode === 'normal' ? undefined : rollDie(6, random)
  const terms = request.dice.map((entry) => rollPoolEntry(entry, random))
  const bonusTotal = terms.reduce((sum, term) => sum + term.subtotal, 0)
  const advantageTotal = advantageRoll === undefined
    ? 0
    : request.modifier_mode === 'advantage' ? advantageRoll : -advantageRoll
  const outcome = hope === fear ? 'critical' : hope > fear ? 'hope' : 'fear'

  return {
    total: hope + fear + bonusTotal + request.modifier + advantageTotal,
    critical: outcome === 'critical',
    outcome,
    hope,
    fear,
    primary_rolls: [hope, fear],
    advantage_roll: advantageRoll,
    terms,
  }
}

function normalizeDicePool(value: DicePoolEntry[] | undefined): DicePoolEntry[] {
  if (!Array.isArray(value)) throw new Error('骰池格式无效')

  const totals = new Map<number, number>()
  for (const entry of value) {
    const sides = boundedInteger(entry?.sides, 2, 1000, '骰子面数')
    if (!ALLOWED_DICE.has(sides)) throw new Error(`不支持 d${sides}`)
    const count = boundedInteger(entry?.count, 0, MAX_DICE_PER_TYPE, '骰子数量')
    if (count > 0) totals.set(sides, Math.min(MAX_DICE_PER_TYPE, (totals.get(sides) ?? 0) + count))
  }

  return Array.from(totals.entries())
    .sort(([left], [right]) => left - right)
    .map(([sides, count]) => ({ sides, count }))
}

function normalizeModifierMode(value: DiceModifierMode | undefined): DiceModifierMode {
  if (value === 'advantage' || value === 'disadvantage') return value
  return 'normal'
}

function rollPoolEntry(entry: DicePoolEntry, random: DiceRandomSource): DiceTermRoll {
  const rolls = rollMany(entry.count, entry.sides, random)
  return {
    notation: `${entry.count}d${entry.sides}`,
    sides: entry.sides,
    count: entry.count,
    rolls,
    subtotal: rolls.reduce((sum, value) => sum + value, 0),
  }
}

function rollMany(count: number, sides: number, random: DiceRandomSource): number[] {
  return Array.from({ length: count }, () => rollDie(sides, random))
}

function rollDie(sides: number, random: DiceRandomSource): number {
  const integer = randomInteger(random, sides)
  if (integer !== undefined) return integer + 1

  const value = randomFloat(random)
  const normalized = Number.isFinite(value) ? Math.min(0.999999999999, Math.max(0, value)) : 0
  return Math.floor(normalized * sides) + 1
}

function randomInteger(random: DiceRandomSource, exclusiveMax: number): number | undefined {
  if (typeof random === 'function' || typeof random.nextInt !== 'function') return undefined

  const value = random.nextInt(exclusiveMax)
  if (!Number.isInteger(value) || value < 0 || value >= exclusiveMax) {
    throw new Error(`随机整数必须在 0 到 ${exclusiveMax - 1} 之间`)
  }
  return value
}

function randomFloat(random: DiceRandomSource): number {
  return typeof random === 'function' ? random() : random.nextFloat?.() ?? Math.random()
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须在 ${min} 到 ${max} 之间`)
  }
  return parsed
}
