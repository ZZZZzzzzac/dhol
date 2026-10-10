import type { CharacterResources, CharacterSheetJson } from '@dhgc/shared/desktop'
import { safeImageSource } from './sheet-utils'

type Card = Record<string, unknown>
const hiddenKeys = new Set(['name', 'ruleSetId', 'hope', 'hopeMax', 'hp', 'stress', 'armorBoxes', 'cards', 'inventory_cards', 'adventureNotes', 'relationships', 'extensions', 'companion', 'companionData'])

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function Cards({ title, value }: { title: string; value: unknown }) {
  if (!Array.isArray(value) || !value.length) return null
  return <section className="sheet-section"><h3>{title}</h3><div className="sheet-card-list">{value.map((item, index) => {
    const card: Card = item && typeof item === 'object' && !Array.isArray(item) ? item as Card : { name: `条目 ${index + 1}`, description: item }
    const image = safeImageSource(card.image ?? card.imageUrl)
    return <article className="sheet-domain-card" key={String(card.id ?? `${text(card.name)}-${index}`)}>{image && <img src={image} alt="" />}<div><h4>{text(card.name ?? card.title) ?? `条目 ${index + 1}`}</h4>{text(card.type) && <p className="sheet-kicker">{text(card.type)}</p>}<p>{text(card.description ?? card.text ?? card.effect) ?? '—'}</p></div></article>
  })}</div></section>
}

function Details({ sheet }: { sheet: CharacterSheetJson }) {
  const entries = Object.entries(sheet).filter(([key, value]) => !hiddenKeys.has(key) && text(value) !== null)
  if (!entries.length) return null
  return <section className="sheet-section"><h3>角色资料</h3><dl className="sheet-details">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl></section>
}

function ObjectSection({ title, value }: { title: string; value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => text(item) !== null)
  if (!entries.length) return null
  return <section className="sheet-section"><h3>{title}</h3><dl className="sheet-details">{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{text(item)}</dd></div>)}</dl></section>
}

function StructuredExtras({ sheet }: { sheet: CharacterSheetJson }) {
  const entries = Object.entries(sheet).filter(([key, value]) => !hiddenKeys.has(key) && value !== null && typeof value === 'object')
  if (!entries.length) return null
  return <section className="sheet-section"><h3>扩展资料</h3><div className="sheet-extras">{entries.map(([key, value]) => <details key={key}><summary>{key}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>)}</div></section>
}

export default function ReadOnlyCharacterSheet({ sheet, resources }: { sheet: CharacterSheetJson; resources: CharacterResources }) {
  const portrait = safeImageSource(sheet.portrait ?? sheet.avatar ?? sheet.image)
  return <div className="readonly-sheet">
    <header className="sheet-hero">{portrait ? <img src={portrait} alt={`${sheet.name}头像`} /> : <span className="sheet-portrait" aria-hidden="true">{[...sheet.name][0] ?? '◇'}</span>}<div><p>{sheet.ruleSetId}</p><h2>{sheet.name}</h2><span>{text(sheet.profession) ?? '未填写职业'} · {text(sheet.level) ? `等级 ${text(sheet.level)}` : '等级 —'}</span></div></header>
    <section className="sheet-resource-strip" aria-label="当前资源"><span>希望 <b>{resources.hope}/{resources.hopeMax}</b></span><span>生命已标记 <b>{resources.hp.filter(Boolean).length}/{resources.hp.length}</b></span><span>压力已标记 <b>{resources.stress.filter(Boolean).length}/{resources.stress.length}</b></span><span>护甲槽已标记 <b>{resources.armor.filter(Boolean).length}/{resources.armor.length}</b></span></section>
    <Details sheet={sheet} />
    <Cards title="领域卡与能力" value={sheet.cards} />
    <Cards title="装备与物品" value={sheet.inventory_cards} />
    <ObjectSection title="伙伴" value={sheet.companion} />
    <ObjectSection title="伙伴资料" value={sheet.companionData} />
    <ObjectSection title="冒险笔记" value={sheet.adventureNotes} />
    <ObjectSection title="关系与扩展资料" value={sheet.relationships ?? sheet.extensions} />
    <StructuredExtras sheet={sheet} />
  </div>
}
