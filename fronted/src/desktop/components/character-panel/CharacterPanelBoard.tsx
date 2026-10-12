import { useState } from 'react'
import type { CharacterSummary, TrackResource } from '@dhgc/shared/desktop'
import CharacterSummaryCard from './CharacterSummaryCard'
import { charactersOnPage, pageCount } from './pagination'

export default function CharacterPanelBoard({ characters, page, ready, onPage, onHope, onMark, onDetail, onDelete, onQuickRollStat, onQuickRollWeapon }: {
  characters: CharacterSummary[]
  page: number
  ready: boolean
  onPage: (page: number) => void
  onHope: (character: CharacterSummary, delta: 1 | -1) => void
  onMark: (character: CharacterSummary, resource: TrackResource, index: number, marked: boolean) => void
  onDetail: (character: CharacterSummary) => void
  onDelete: (character: CharacterSummary) => void
  onQuickRollStat?: (statName: string, statVal: string) => void
  onQuickRollWeapon?: (weaponName: string, weaponDamage: string) => void
}) {
  const [deleteTarget, setDeleteTarget] = useState<CharacterSummary | null>(null)
  const pages = pageCount(characters.length)
  const safePage = Math.min(page, pages - 1)

  if (!characters.length) return <section className="empty-state"><h2>暂无角色</h2></section>

  return <section aria-label="玩家" className="players-section">
    <div className="section-head">
      <h2 className="section-title">玩家</h2>
    </div>
    <div className="character-grid">
      {charactersOnPage(characters, safePage).map(character => (
        <CharacterSummaryCard
          key={`${character.name}:${character.generation}`}
          character={character}
          ready={ready}
          onHope={delta => onHope(character, delta)}
          onMark={(resource, index, marked) => onMark(character, resource, index, marked)}
          onDetail={() => onDetail(character)}
          onDelete={() => setDeleteTarget(character)}
          onQuickRollStat={onQuickRollStat}
          onQuickRollWeapon={onQuickRollWeapon}
        />
      ))}
    </div>
    {pages > 1 && (
      <nav className="pagination" aria-label="角色分页">
        <button type="button" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>上一页</button>
        <span>第 {safePage + 1} / {pages} 页</span>
        <button type="button" disabled={safePage === pages - 1} onClick={() => onPage(safePage + 1)}>下一页</button>
      </nav>
    )}

    {/* 移除角色确认弹窗 */}
    {deleteTarget && (
      <div className="modal-overlay show">
        <div className="modal-box modal-box--sm">
          <div className="modal-bar">
            <h2>移除角色</h2>
            <button type="button" onClick={() => setDeleteTarget(null)}>关闭</button>
          </div>
          <div className="modal-content">
            <p style={{ fontSize: '16px', fontWeight: 700 }}>
              确定移除角色【<span style={{ color: 'var(--red)' }}>{deleteTarget.name}</span>】？此操作将清空其席位。
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="btn-alert-confirm" onClick={() => { onDelete(deleteTarget); setDeleteTarget(null) }}>移除</button>
            </div>
          </div>
        </div>
      </div>
    )}
  </section>
}
