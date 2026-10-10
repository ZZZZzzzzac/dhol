import type { CharacterSummary, TrackResource } from '@dhgc/shared/desktop'
import CharacterSummaryCard from './CharacterSummaryCard'
import { charactersOnPage, pageCount } from './pagination'

export default function CharacterPanelBoard({ characters, page, ready, onPage, onHope, onMark, onDetail, onDelete }: {
  characters: CharacterSummary[]
  page: number
  ready: boolean
  onPage: (page: number) => void
  onHope: (character: CharacterSummary, delta: 1 | -1) => void
  onMark: (character: CharacterSummary, resource: TrackResource, index: number, marked: boolean) => void
  onDetail: (character: CharacterSummary) => void
  onDelete: (character: CharacterSummary) => void
}) {
  const pages = pageCount(characters.length)
  const safePage = Math.min(page, pages - 1)
  if (!characters.length) return <section className="empty-state"><span aria-hidden="true">◇</span><h2>等待角色加入</h2><p>在车卡器中选择“发送到在线面板”，输入本房间的六位邀请码。</p></section>
  return <section aria-label="角色面板">
    <div className="character-grid">{charactersOnPage(characters, safePage).map(character => <CharacterSummaryCard key={`${character.name}:${character.generation}`} character={character} ready={ready}
      onHope={delta => onHope(character, delta)} onMark={(resource, index, marked) => onMark(character, resource, index, marked)}
      onDetail={() => onDetail(character)} onDelete={() => onDelete(character)} />)}</div>
    {pages > 1 && <nav className="pagination" aria-label="角色分页"><button type="button" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>上一页</button><span>第 {safePage + 1} / {pages} 页</span><button type="button" disabled={safePage === pages - 1} onClick={() => onPage(safePage + 1)}>下一页</button></nav>}
  </section>
}
