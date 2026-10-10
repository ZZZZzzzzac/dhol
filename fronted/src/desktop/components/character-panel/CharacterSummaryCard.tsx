import { memo } from 'react'
import type { CharacterSummary, TrackResource } from '@dhgc/shared/desktop'
import ResourceTrack from './ResourceTrack'

const attributes: Array<[keyof CharacterSummary['attributes'], string]> = [
  ['agility', '敏捷'], ['strength', '力量'], ['finesse', '灵巧'],
  ['instinct', '本能'], ['presence', '风度'], ['knowledge', '知识'],
]

function CharacterSummaryCard({ character, ready, onHope, onMark, onDetail, onDelete }: {
  character: CharacterSummary
  ready: boolean
  onHope: (delta: 1 | -1) => void
  onMark: (resource: TrackResource, index: number, marked: boolean) => void
  onDetail: () => void
  onDelete: () => void
}) {
  const value = (item: string | null) => item ?? '—'
  return <article className="character-card" aria-labelledby={`character-${character.generation}`}>
    <header className="character-card__identity">
      <div><p>{character.ruleSetId === 'daggerheart' ? 'DAGGERHEART' : 'RHODES ISLAND'}</p><h2 id={`character-${character.generation}`}>{character.name}</h2></div>
      <span>{[character.profession, character.level && `等级 ${character.level}`].filter(Boolean).join(' · ') || '未填写职业'}</span>
    </header>
    <section className="character-card__resources" aria-label="四项资源">
      <div className="hope-control"><div><strong>希望</strong><span>当前值</span></div><button type="button" disabled={!ready || character.resources.hope === 0} onClick={() => onHope(-1)} aria-label="减少一点希望">−</button><b>{character.resources.hope} / {character.resources.hopeMax}</b><button type="button" disabled={!ready || character.resources.hope === character.resources.hopeMax} onClick={() => onHope(1)} aria-label="增加一点希望">+</button></div>
      <ResourceTrack resource="hp" marks={character.resources.hp} disabled={!ready} onChange={(index, marked) => onMark('hp', index, marked)} />
      <ResourceTrack resource="stress" marks={character.resources.stress} disabled={!ready} onChange={(index, marked) => onMark('stress', index, marked)} />
      <ResourceTrack resource="armor" marks={character.resources.armor} disabled={!ready} onChange={(index, marked) => onMark('armor', index, marked)} />
    </section>
    <dl className="character-card__combat"><div><dt>闪避</dt><dd>{value(character.evasion)}</dd></div><div><dt>护甲值</dt><dd>{value(character.armorValue)}</dd></div><div><dt>轻伤阈值</dt><dd>{value(character.minorThreshold)}</dd></div><div><dt>重伤阈值</dt><dd>{value(character.majorThreshold)}</dd></div></dl>
    <dl className="character-card__attributes">{attributes.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(character.attributes[key])}</dd></div>)}</dl>
    <div className="character-card__weapons"><span><small>主武器伤害</small>{value(character.primaryWeaponDamage)}</span><span><small>副武器伤害</small>{value(character.secondaryWeaponDamage)}</span></div>
    <footer><button type="button" className="button button--primary" onClick={onDetail}>查看完整信息</button><button type="button" className="button button--danger-ghost" disabled={!ready} onClick={onDelete}>删除角色</button></footer>
  </article>
}

export default memo(CharacterSummaryCard)
