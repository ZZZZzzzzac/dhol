import type { ReactNode } from 'react'
import type { CharacterResources, CharacterSheetJson } from '@dhgc/shared/desktop'

type SheetRecord = Record<string, unknown>

const labels: Record<string, string> = {
  level: '等级', profession: '职业', community: '社群', subclass: '分支',
  ancestry1: '种族', ancestry2: '第二种族', proficiency: '熟练度',
  evasion: '闪避值', armorValue: '护甲值', armorName: '护甲', armorBaseScore: '护甲基础值', armorThreshold: '护甲阈值', armorFeature: '护甲特性', armorBonus: '护甲加值',
  minorThreshold: '轻伤阈值', majorThreshold: '重伤阈值',
  agility: '敏捷', strength: '力量', finesse: '灵巧', instinct: '本能', presence: '风度', knowledge: '知识',
  primaryWeaponName: '主武器', primaryWeaponTrait: '主武器属性', primaryWeaponDamage: '主武器伤害', primaryWeaponFeature: '主武器特性',
  secondaryWeaponName: '副武器', secondaryWeaponTrait: '副武器属性', secondaryWeaponDamage: '副武器伤害', secondaryWeaponFeature: '副武器特性',
  inventoryWeapon1Name: '备用武器一', inventoryWeapon1Trait: '备用武器一属性', inventoryWeapon1Damage: '备用武器一伤害', inventoryWeapon1Feature: '备用武器一特性',
  inventoryWeapon2Name: '备用武器二', inventoryWeapon2Trait: '备用武器二属性', inventoryWeapon2Damage: '备用武器二伤害', inventoryWeapon2Feature: '备用武器二特性',
  characterBackground: '背景', characterAppearance: '外貌', characterMotivation: '动机',
  companionName: '伙伴名称', companionDescription: '伙伴描述', companionWeapon: '攻击方式', companionRange: '伤害骰', companionEvasion: '闪避值',
  characterProfile: '角色简介', playerInfo: '玩家信息', backstory: '背景故事', milestones: '大事记', adventureLog: '冒险履历',
  race: '种族', age: '年龄', gender: '性别', height: '身高', weight: '体重', skinColor: '肤色', eyeColor: '瞳色', hairColor: '发色', birthplace: '出生地', faith: '信仰／理念', otherInfo: '其他信息',
  nickname: '昵称', preference: '偏好', activeTime: '活动时间', playStyle: '游戏风格',
  date: '时间', levelRange: '等级跨度', trauma: '创伤', backgroundQuestions: '背景问题', relationships: '关系',
  name: '名称', title: '名称', type: '类型', description: '描述', text: '正文', effect: '效果', feature: '特性', cost: '花费', domain: '领域', rarity: '稀有度',
}

const technicalKeys = new Set([
  'name', 'ruleSetId', 'hope', 'hopeMax', 'hp', 'hpMax', 'stress', 'stressMax', 'armorBoxes', 'armorMax',
  'cards', 'inventory_cards', 'adventureNotes', 'rhodesIslandRelationshipAnswers', 'trainingOptions', 'armorTemplate',
  'pageVisibility', 'includePageThreeInExport', 'notebook', 'checkedUpgrades', 'domainCardAutomation', 'rulesetAutomationVersions',
  'professionRef', 'ancestry1Ref', 'ancestry2Ref', 'communityRef', 'subclassRef', 'primaryWeaponSelection', 'secondaryWeaponSelection', 'armorSelection',
  'characterImage', 'portrait', 'avatar', 'image', 'companionImage', 'presetEquipmentCalcVersion',
])

const groupedKeys = new Set([
  'level', 'profession', 'community', 'subclass', 'ancestry1', 'ancestry2', 'proficiency',
  'evasion', 'armorValue', 'armorName', 'armorBaseScore', 'armorThreshold', 'armorFeature', 'armorBonus', 'minorThreshold', 'majorThreshold',
  'agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge',
  'primaryWeaponName', 'primaryWeaponTrait', 'primaryWeaponDamage', 'primaryWeaponFeature',
  'secondaryWeaponName', 'secondaryWeaponTrait', 'secondaryWeaponDamage', 'secondaryWeaponFeature',
  'inventoryWeapon1Name', 'inventoryWeapon1Trait', 'inventoryWeapon1Damage', 'inventoryWeapon1Feature',
  'inventoryWeapon2Name', 'inventoryWeapon2Trait', 'inventoryWeapon2Damage', 'inventoryWeapon2Feature',
  'experience', 'experienceValues', 'ancestryExperience', 'ancestryExperienceValues', 'inventory',
  'characterBackground', 'characterAppearance', 'characterMotivation',
  'companionName', 'companionDescription', 'companionWeapon', 'companionRange', 'companionEvasion', 'companionExperience', 'companionExperienceValue', 'companionStress', 'companionStressMax',
])

function record(value: unknown): SheetRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SheetRecord : null
}

function label(key: string): string {
  return labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') {
    const cleaned = value.trim()
    if (!cleaned || /^data:image\//i.test(cleaned)) return null
    return cleaned
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return null
}

function attribute(value: unknown): string | null {
  const item = record(value)
  return scalar(item?.value ?? value)
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalar).filter((item): item is string => item !== null) : []
}

function Fields({ entries, className = '' }: { entries: Array<[string, unknown]>; className?: string }) {
  const visible = entries.map(([key, value]) => [key, attribute(value)] as const).filter((entry): entry is readonly [string, string] => entry[1] !== null)
  if (!visible.length) return null
  return <dl className={`sheet-text-grid ${className}`.trim()}>{visible.map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value}</dd></div>)}</dl>
}

function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return <section className="sheet-section"><header className="sheet-section__heading">{eyebrow && <span>{eyebrow}</span>}<h3>{title}</h3></header>{children}</section>
}

function TextBlock({ label: heading, value }: { label: string; value: unknown }) {
  const content = scalar(value)
  if (!content) return null
  return <article className="sheet-text-block"><h4>{heading}</h4><p>{content}</p></article>
}

function NamedList({ title, values, scores }: { title: string; values: unknown; scores?: unknown }) {
  const names = list(values)
  const modifiers = list(scores)
  if (!names.length) return null
  return <Section title={title}><div className="sheet-line-list">{names.map((name, index) => <p key={`${name}-${index}`}><strong>{name}</strong>{modifiers[index] && <span>{modifiers[index]}</span>}</p>)}</div></Section>
}

function Cards({ title, value }: { title: string; value: unknown }) {
  if (!Array.isArray(value)) return null
  const cards = value.map(record).filter((item): item is SheetRecord => item !== null && Object.values(item).some(scalar))
  if (!cards.length) return null
  return <Section title={title} eyebrow="CARDS"><div className="sheet-card-list">{cards.map((card, index) => {
    const heading = scalar(card.name ?? card.title) ?? `条目 ${index + 1}`
    const body = scalar(card.description ?? card.text ?? card.effect)
    const metadata = Object.entries(card).filter(([key, item]) => !['id', 'name', 'title', 'description', 'text', 'effect', 'image', 'imageUrl', 'art', 'artwork'].includes(key) && scalar(item) !== null)
    return <article className="sheet-domain-card" key={String(card.id ?? `${heading}-${index}`)}><div><p className="sheet-kicker">{[scalar(card.type), scalar(card.domain), scalar(card.level) && `等级 ${scalar(card.level)}`].filter(Boolean).join(' · ') || '角色卡牌'}</p><h4>{heading}</h4>{body && <p>{body}</p>}<Fields entries={metadata} className="sheet-text-grid--compact" /></div></article>
  })}</div></Section>
}

function Companion({ sheet }: { sheet: CharacterSheetJson }) {
  const hasCompanion = ['companionName', 'companionDescription', 'companionWeapon', 'companionRange', 'companionEvasion'].some(key => scalar(sheet[key])) || list(sheet.companionExperience).length > 0
  if (!hasCompanion) return null
  return <Section title="游侠伙伴" eyebrow="COMPANION"><Fields entries={[
    ['companionName', sheet.companionName], ['companionEvasion', sheet.companionEvasion], ['companionWeapon', sheet.companionWeapon], ['companionRange', sheet.companionRange],
  ]} /><TextBlock label="伙伴描述" value={sheet.companionDescription} /><NamedList title="伙伴经历" values={sheet.companionExperience} scores={sheet.companionExperienceValue} /></Section>
}

function AdventureNotes({ value }: { value: unknown }) {
  const notes = record(value)
  if (!notes) return null
  const profile = record(notes.characterProfile)
  const player = record(notes.playerInfo)
  const logs = Array.isArray(notes.adventureLog) ? notes.adventureLog.map(record).filter((item): item is SheetRecord => item !== null) : []
  if (!profile && !player && !scalar(notes.backstory) && !scalar(notes.milestones) && !logs.length) return null
  return <Section title="冒险笔记" eyebrow="ADVENTURE NOTES"><div className="sheet-note-columns"><div>{profile && <><h4>角色简介</h4><Fields entries={Object.entries(profile)} /></>}{player && <><h4>玩家信息</h4><Fields entries={Object.entries(player)} /></>}</div><div><TextBlock label="背景故事" value={notes.backstory} /><TextBlock label="大事记" value={notes.milestones} /></div></div>{logs.length > 0 && <div className="sheet-log"><h4>冒险履历</h4>{logs.map((entry, index) => <Fields key={index} entries={Object.entries(entry)} />)}</div>}</Section>
}

function Relationships({ value }: { value: unknown }) {
  const groups = record(value)
  if (!groups) return null
  const answers = Object.entries(groups).flatMap(([profession, raw]) => {
    const group = record(raw)
    if (!group) return []
    return ['backgroundQuestions', 'relationships'].flatMap(key => list(group[key]).map((answer, index) => ({ profession, key, answer, index })))
  })
  if (!answers.length) return null
  return <Section title="关系与问题" eyebrow="RELATIONSHIPS"><div className="sheet-answer-list">{answers.map(item => <article key={`${item.profession}-${item.key}-${item.index}`}><span>{label(item.key)} {item.index + 1}</span><p>{item.answer}</p></article>)}</div></Section>
}

function ReadableValue({ name, value }: { name: string; value: unknown }) {
  const plain = scalar(value)
  if (plain) return <TextBlock label={label(name)} value={plain} />
  const values = list(value)
  if (values.length) return <article className="sheet-text-block"><h4>{label(name)}</h4>{values.map((item, index) => <p key={index}>{item}</p>)}</article>
  const item = record(value)
  if (!item) return null
  const entries = Object.entries(item).filter(([key, nested]) => !/image|ref|version|selection/i.test(key) && scalar(nested) !== null)
  return entries.length ? <article className="sheet-text-block"><h4>{label(name)}</h4><Fields entries={entries} /></article> : null
}

function Extras({ sheet }: { sheet: CharacterSheetJson }) {
  const entries = Object.entries(sheet).filter(([key, value]) => !technicalKeys.has(key) && !groupedKeys.has(key) && !/image|ref|version|selection|modifier/i.test(key) && (scalar(value) !== null || list(value).length > 0 || record(value)))
  if (!entries.length) return null
  return <Section title="其他信息"><div className="sheet-extra-text">{entries.map(([key, value]) => <ReadableValue key={key} name={key} value={value} />)}</div></Section>
}

export default function ReadOnlyCharacterSheet({ sheet, resources }: { sheet: CharacterSheetJson; resources: CharacterResources }) {
  const subtitle = [scalar(sheet.profession), scalar(sheet.level) && `等级 ${scalar(sheet.level)}`].filter(Boolean).join(' · ') || '角色资料'
  return <article className="readonly-sheet">
    <header className="sheet-hero"><span className="sheet-portrait" aria-hidden="true">{[...sheet.name][0] ?? '◇'}</span><div><p>{sheet.ruleSetId === 'rhodes-island' ? 'RHODES ISLAND' : 'DAGGERHEART'}</p><h2>{sheet.name}</h2><span>{subtitle}</span></div></header>
    <section className="sheet-resource-strip" aria-label="当前资源"><span>希望 <b>{resources.hope}/{resources.hopeMax}</b></span><span>生命已标记 <b>{resources.hp.filter(Boolean).length}/{resources.hp.length}</b></span><span>压力已标记 <b>{resources.stress.filter(Boolean).length}/{resources.stress.length}</b></span><span>护甲槽已标记 <b>{resources.armor.filter(Boolean).length}/{resources.armor.length}</b></span></section>
    <Section title="角色资料" eyebrow="CHARACTER"><Fields entries={[
      ['level', sheet.level], ['profession', sheet.profession], ['subclass', sheet.subclass], ['community', sheet.community], ['ancestry1', sheet.ancestry1], ['ancestry2', sheet.ancestry2], ['proficiency', Array.isArray(sheet.proficiency) ? sheet.proficiency.filter(Boolean).length : sheet.proficiency],
    ]} /></Section>
    <Section title="属性与战斗" eyebrow="CORE STATS"><Fields entries={[
      ['evasion', sheet.evasion], ['armorValue', sheet.armorValue], ['minorThreshold', sheet.minorThreshold], ['majorThreshold', sheet.majorThreshold],
      ['agility', sheet.agility], ['strength', sheet.strength], ['finesse', sheet.finesse], ['instinct', sheet.instinct], ['presence', sheet.presence], ['knowledge', sheet.knowledge],
    ]} /></Section>
    <Section title="武器与护甲" eyebrow="EQUIPMENT"><Fields entries={[
      ['primaryWeaponName', sheet.primaryWeaponName], ['primaryWeaponTrait', sheet.primaryWeaponTrait], ['primaryWeaponDamage', sheet.primaryWeaponDamage], ['primaryWeaponFeature', sheet.primaryWeaponFeature],
      ['secondaryWeaponName', sheet.secondaryWeaponName], ['secondaryWeaponTrait', sheet.secondaryWeaponTrait], ['secondaryWeaponDamage', sheet.secondaryWeaponDamage], ['secondaryWeaponFeature', sheet.secondaryWeaponFeature],
      ['armorName', sheet.armorName], ['armorBaseScore', sheet.armorBaseScore], ['armorThreshold', sheet.armorThreshold], ['armorFeature', sheet.armorFeature],
      ['inventoryWeapon1Name', sheet.inventoryWeapon1Name], ['inventoryWeapon1Trait', sheet.inventoryWeapon1Trait], ['inventoryWeapon1Damage', sheet.inventoryWeapon1Damage], ['inventoryWeapon1Feature', sheet.inventoryWeapon1Feature],
      ['inventoryWeapon2Name', sheet.inventoryWeapon2Name], ['inventoryWeapon2Trait', sheet.inventoryWeapon2Trait], ['inventoryWeapon2Damage', sheet.inventoryWeapon2Damage], ['inventoryWeapon2Feature', sheet.inventoryWeapon2Feature],
    ]} /></Section>
    <NamedList title="经历" values={sheet.experience} scores={sheet.experienceValues} />
    <NamedList title="种族经历" values={sheet.ancestryExperience} scores={sheet.ancestryExperienceValues} />
    <section className="sheet-narrative"><TextBlock label="背景" value={sheet.characterBackground} /><TextBlock label="外貌" value={sheet.characterAppearance} /><TextBlock label="动机" value={sheet.characterMotivation} /></section>
    <NamedList title="物品栏" values={sheet.inventory} />
    <Cards title="配置卡组" value={sheet.cards} />
    <Cards title="宝库卡组" value={sheet.inventory_cards} />
    <Companion sheet={sheet} />
    <AdventureNotes value={sheet.adventureNotes} />
    <Relationships value={sheet.rhodesIslandRelationshipAnswers} />
    <Extras sheet={sheet} />
  </article>
}
