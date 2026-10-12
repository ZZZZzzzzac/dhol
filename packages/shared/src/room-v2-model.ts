import type { DiceRollRecord } from './dice-types'

export type RuleSetId = 'daggerheart' | 'rhodes-island'
export type TrackResource = 'hp' | 'stress' | 'armor'
export interface CharacterResources {
  hope: number
  hopeMax: number
  hp: boolean[]
  stress: boolean[]
  armor: boolean[]
}
export interface CharacterSummary {
  name: string
  ruleSetId: RuleSetId
  generation: number
  position: number
  resources: CharacterResources
  level: string | null
  profession: string | null
  evasion: string | null
  armorValue: string | null
  minorThreshold: string | null
  majorThreshold: string | null
  attributes: Record<'agility' | 'strength' | 'finesse' | 'instinct' | 'presence' | 'knowledge', string | null>
  primaryWeaponName: string | null
  primaryWeaponTrait: string | null
  primaryWeaponRange: string | null
  primaryWeaponDamage: string | null
  secondaryWeaponName: string | null
  secondaryWeaponTrait: string | null
  secondaryWeaponRange: string | null
  secondaryWeaponDamage: string | null
}
export interface RoomMember {
  id: string
  nickname: string
  online: boolean
}
export interface RoomV2Model {
  protocolVersion: 2
  roomId: string
  name: string
  inviteCode: string
  expiresAt: string
  seq: number
  members: RoomMember[]
  characters: CharacterSummary[]
  fear: { value: number; max: number }
  dice: DiceRollRecord[]
  xCard: { active: boolean; updatedAt: string | null }
}
