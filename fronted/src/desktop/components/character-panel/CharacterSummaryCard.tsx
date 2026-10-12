import { memo } from 'react'
import type { CharacterSummary, TrackResource } from '@dhgc/shared/desktop'
import ResourceTrack from './ResourceTrack'

const attributes: Array<[keyof CharacterSummary['attributes'], string]> = [
  ['agility', '敏捷'], ['strength', '力量'], ['finesse', '灵巧'],
  ['instinct', '本能'], ['presence', '风度'], ['knowledge', '知识'],
]

function CharacterSummaryCard({ character, ready, onHope, onMark, onDetail, onDelete, onQuickRollStat, onQuickRollWeapon }: {
  character: CharacterSummary
  ready: boolean
  onHope: (delta: 1 | -1) => void
  onMark: (resource: TrackResource, index: number, marked: boolean) => void
  onDetail: () => void
  onDelete: () => void
  onQuickRollStat?: (statName: string, statVal: string) => void
  onQuickRollWeapon?: (weaponName: string, weaponDamage: string) => void
}) {
  const value = (item: string | null) => item ?? '—'
  const hopeSlots = Array.from({ length: character.resources.hopeMax || 6 }, (_, i) => i < character.resources.hope)

  return <article className="character-card" aria-labelledby={`character-${character.generation}`}>
    <header className="character-card__identity">
      <div className="player-title-row">
        <h2 id={`character-${character.generation}`} className="player-name">{character.name}</h2>
        <span className="player-sub">{[character.profession, character.level && `${character.level}级`].filter(Boolean).join(' · ')}</span>
      </div>
      <button type="button" className="btn-remove-player" disabled={!ready} onClick={onDelete}>移除</button>
    </header>
    <section className="character-card__resources" aria-label="四项资源">
      <div className="hope-control">
        <div className="hope-control__label">
          <strong className="track-title--blue">希望</strong>
          <span>{character.resources.hope} / {character.resources.hopeMax}</span>
        </div>
        <div className="hope-wrap">
          <div className="hope-diamonds">
            {hopeSlots.map((active, i) => <span key={i} className={`hope-diamond ${active ? 'active' : ''}`} />)}
          </div>
          <b className="hope-number">{character.resources.hope}</b>
        </div>
        <div className="track-steppers">
          <button type="button" disabled={!ready || character.resources.hope === 0} onClick={() => onHope(-1)} aria-label="减少一点希望">−</button>
          <button type="button" disabled={!ready || character.resources.hope === character.resources.hopeMax} onClick={() => onHope(1)} aria-label="增加一点希望">+</button>
        </div>
      </div>
      <ResourceTrack resource="hp" marks={character.resources.hp} disabled={!ready} onChange={(index, marked) => onMark('hp', index, marked)} />
      <ResourceTrack resource="stress" marks={character.resources.stress} disabled={!ready} onChange={(index, marked) => onMark('stress', index, marked)} />
      <ResourceTrack resource="armor" marks={character.resources.armor} disabled={!ready} onChange={(index, marked) => onMark('armor', index, marked)} />
    </section>
    <dl className="character-card__combat">
      <div><dt>闪避</dt><dd>{value(character.evasion)}</dd></div>
      <div><dt>护甲值</dt><dd>{value(character.armorValue)}</dd></div>
      <div><dt>轻伤阈值</dt><dd>{value(character.minorThreshold)}</dd></div>
      <div><dt>重伤阈值</dt><dd>{value(character.majorThreshold)}</dd></div>
    </dl>
    <dl className="character-card__attributes">
      {attributes.map(([key, label]) => {
        const val = value(character.attributes[key])
        return <div key={key} className="attr-cell" onClick={() => onQuickRollStat?.(label, val)}>
          <dt>{label}</dt><dd>{val}</dd>
        </div>
      })}
    </dl>
    <div className="character-card__weapons">
      <span className="weapon-btn" onClick={() => onQuickRollWeapon?.('主武器', value(character.primaryWeaponDamage))}>
        <small>主武器伤害</small><strong>{value(character.primaryWeaponDamage)}</strong>
      </span>
      {character.secondaryWeaponDamage && <span className="weapon-btn" onClick={() => onQuickRollWeapon?.('副武器', value(character.secondaryWeaponDamage))}>
        <small>副武器伤害</small><strong>{value(character.secondaryWeaponDamage)}</strong>
      </span>}
    </div>
    <footer>
      <button type="button" className="button button--primary btn-detail" onClick={onDetail}>完整信息</button>
    </footer>
  </article>
}

export default memo(CharacterSummaryCard)
