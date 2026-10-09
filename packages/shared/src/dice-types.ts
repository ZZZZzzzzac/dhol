export type DiceRollMode = 'standard' | 'dual'
export type DiceModifierMode = 'normal' | 'advantage' | 'disadvantage'
export type DiceRollOutcome = 'hope' | 'fear' | 'critical'

export interface DicePoolEntry { sides: number; count: number }
export interface DiceRollRequest {
  mode: DiceRollMode
  modifier_mode: DiceModifierMode
  repeat: number
  modifier: number
  dice: DicePoolEntry[]
}
export interface DiceTermRoll {
  notation: string
  sides: number
  count: number
  rolls: number[]
  subtotal: number
}
export interface DiceRollResult {
  total: number
  critical: boolean
  outcome?: DiceRollOutcome
  hope?: number
  fear?: number
  primary_rolls: number[]
  kept_primary?: number
  advantage_roll?: number
  terms: DiceTermRoll[]
}
export interface DiceRollRecord {
  id: string
  created_at: string
  actor_player_id: string
  actor_name: string
  normalized_formula: string
  request: DiceRollRequest
  mode: DiceRollMode
  modifier_mode: DiceModifierMode
  results: DiceRollResult[]
}
