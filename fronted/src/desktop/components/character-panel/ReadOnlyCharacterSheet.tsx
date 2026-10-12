import type { ReactNode } from 'react'
import type { CharacterResources, CharacterSheetJson } from '@dhgc/shared/desktop'

type SheetRecord = Record<string, unknown>

function record(value: unknown): SheetRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SheetRecord : null
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

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalar).filter((item): item is string => item !== null) : []
}

// ===== SAFE INLINE MARKDOWN PARSER =====
function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={key++}><em>{match[2]}</em></strong>)
    } else if (match[3]) {
      parts.push(<strong key={key++}>{match[3]}</strong>)
    } else if (match[4]) {
      parts.push(<em key={key++}>{match[4]}</em>)
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export function MarkdownContent({ content }: { content: string }) {
  if (!content) return null
  const blocks = content.trim().split(/\n\s*\n/)
  return (
    <div className="sheet-md-content">
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        const isList = lines.length > 0 && lines.every(l => l.startsWith('- ') || l.startsWith('* '))
        if (isList) {
          return (
            <ul key={bIdx}>
              {lines.map((l, lIdx) => (
                <li key={lIdx}>{renderInlineMarkdown(l.replace(/^[-*]\s+/, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bIdx}>
            {lines.map((l, lIdx) => (
              <span key={lIdx}>
                {lIdx > 0 && <br />}
                {renderInlineMarkdown(l)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

// ===== CARD TYPE CONFIG =====
const TYPE_CONFIG: Record<string, { label: string; cls: string }> = {
  profession: { label: '职业', cls: 'sheet-card-chip--profession' },
  subclass:   { label: '子职', cls: 'sheet-card-chip--subclass' },
  ancestry:   { label: '种族', cls: 'sheet-card-chip--ancestry' },
  community:  { label: '社群', cls: 'sheet-card-chip--community' },
  domain:     { label: '领域能力', cls: 'sheet-card-chip--domain' },
  variant:    { label: '野兽形态', cls: 'sheet-card-chip--variant' },
}

// ===== WEAPON / ARMOR CARDS =====
function WeaponCard({ slot, name, trait, damage, feature }: { slot: string; name?: unknown; trait?: unknown; damage?: unknown; feature?: unknown }) {
  const weaponName = scalar(name)
  if (!weaponName) {
    return (
      <article className="sheet-weapon-card sheet-weapon-card--empty">
        <header className="sheet-weapon-card__bar">
          <span className="sheet-weapon-card__name">未装备</span>
          <span className="sheet-weapon-card__slot">{slot}</span>
        </header>
        <div className="sheet-weapon-card__content">
          <span>— 无{slot}配置 —</span>
        </div>
      </article>
    )
  }

  const traitStr = scalar(trait)
  const damageStr = scalar(damage)
  const featureStr = scalar(feature)

  return (
    <article className="sheet-weapon-card">
      <header className="sheet-weapon-card__bar">
        <span className="sheet-weapon-card__name">{weaponName}</span>
        <span className="sheet-weapon-card__slot">{slot}</span>
      </header>
      <div className="sheet-weapon-card__content">
        {traitStr && (
          <div className="sheet-weapon-meta-row">
            <span className="sheet-weapon-meta-key">属性特征</span>
            <span className="sheet-weapon-meta-val">{traitStr}</span>
          </div>
        )}
        {damageStr && (
          <div className="sheet-weapon-meta-row">
            <span className="sheet-weapon-meta-key">伤害值</span>
            <span className="sheet-weapon-meta-val sheet-weapon-meta-val--damage">{damageStr}</span>
          </div>
        )}
        {featureStr && (
          <div className="sheet-weapon-feature-box">
            <MarkdownContent content={featureStr} />
          </div>
        )}
      </div>
    </article>
  )
}

function ArmorCard({ name, baseScore, threshold, feature }: { name?: unknown; baseScore?: unknown; threshold?: unknown; feature?: unknown }) {
  const armorName = scalar(name)
  if (!armorName) {
    return (
      <article className="sheet-weapon-card sheet-weapon-card--empty">
        <header className="sheet-weapon-card__bar">
          <span className="sheet-weapon-card__name">未装备</span>
          <span className="sheet-weapon-card__slot">护甲</span>
        </header>
        <div className="sheet-weapon-card__content">
          <span>— 未装备身体防具 —</span>
        </div>
      </article>
    )
  }

  const baseStr = scalar(baseScore)
  const threshStr = scalar(threshold)
  const featureStr = scalar(feature)

  return (
    <article className="sheet-weapon-card">
      <header className="sheet-weapon-card__bar">
        <span className="sheet-weapon-card__name">{armorName}</span>
        <span className="sheet-weapon-card__slot">护甲</span>
      </header>
      <div className="sheet-weapon-card__content">
        {baseStr && (
          <div className="sheet-weapon-meta-row">
            <span className="sheet-weapon-meta-key">护甲基础值</span>
            <span className="sheet-weapon-meta-val">{baseStr}</span>
          </div>
        )}
        {threshStr && (
          <div className="sheet-weapon-meta-row">
            <span className="sheet-weapon-meta-key">伤害阈值</span>
            <span className="sheet-weapon-meta-val sheet-weapon-meta-val--damage">{threshStr}</span>
          </div>
        )}
        {featureStr ? (
          <div className="sheet-weapon-feature-box">
            <MarkdownContent content={featureStr} />
          </div>
        ) : (
          <div className="sheet-weapon-feature-box sheet-muted-text">无特殊护甲特性</div>
        )}
      </div>
    </article>
  )
}

// ===== GOLD CONTROLLER (Vehicle Sheet 3 Tiers) =====
function GoldInteractive({ gold: savedGold, initialGold, onChange, disabled }: { gold?: boolean[]; initialGold?: unknown; onChange?: (index: number, marked: boolean) => void; disabled: boolean }) {
  const source = savedGold ?? (Array.isArray(initialGold) ? initialGold : [])
  const gold = Array.from({ length: 21 }, (_, index) => Boolean(source[index]))
  const toggle = (index: number) => onChange?.(index, !gold[index])

  const handfulChecked = gold.slice(0, 10).filter(Boolean).length
  const bagChecked = gold.slice(10, 20).filter(Boolean).length
  const chest = gold[20]

  return (
    <div className="sheet-gold-container">
      {/* 把 (10个圆孔) */}
      <div className="sheet-gold-row">
        <span className="sheet-gold-tier-badge">把</span>
        <div className="sheet-gold-grid">
          {gold.slice(0, 10).map((checked, i) => (
            <button
              type="button"
              key={`handful-${i}`}
              className={`sheet-gold-chk ${checked ? 'checked' : ''}`}
              onClick={() => toggle(i)}
              disabled={disabled || !onChange}
              aria-pressed={checked}
              aria-label={`金币（把）${i + 1}`}
            />
          ))}
        </div>
        <span className="sheet-gold-count">{handfulChecked} / 10</span>
      </div>

      {/* 袋 (10个方孔) */}
      <div className="sheet-gold-row">
        <span className="sheet-gold-tier-badge sheet-gold-tier-badge--bag">袋</span>
        <div className="sheet-gold-grid">
          {gold.slice(10, 20).map((checked, i) => (
            <button
              type="button"
              key={`bag-${i}`}
              className={`sheet-gold-chk sheet-gold-chk--bag ${checked ? 'checked' : ''}`}
              onClick={() => toggle(10 + i)}
              disabled={disabled || !onChange}
              aria-pressed={checked}
              aria-label={`金币（袋）${i + 1}`}
            />
          ))}
        </div>
        <span className="sheet-gold-count">{bagChecked} / 10</span>
      </div>

      {/* 箱 (1个大宝箱孔) */}
      <div className="sheet-gold-row">
        <span className="sheet-gold-tier-badge sheet-gold-tier-badge--chest">箱</span>
        <div className="sheet-gold-grid">
          <button
            type="button"
            className={`sheet-gold-chk sheet-gold-chk--chest ${chest ? 'checked' : ''}`}
            onClick={() => toggle(20)}
            disabled={disabled || !onChange}
            aria-pressed={chest}
            aria-label="金币（箱）"
          />
        </div>
        <span className="sheet-gold-count">{chest ? 1 : 0} / 1</span>
      </div>
    </div>
  )
}

const labels: Record<string, string> = {
  level: '等级', profession: '职业', community: '社群', subclass: '分支',
  ancestry1: '种族', ancestry2: '第二种族', proficiency: '熟练度',
  evasion: '闪避值', armorValue: '护甲值', armorName: '护甲', armorBaseScore: '护甲基础值', armorThreshold: '护甲阈值', armorFeature: '护甲特性', armorBonus: '护甲加值',
  minorThreshold: '轻伤阈值', majorThreshold: '重伤阈值',
  agility: '敏捷', strength: '力量', finesse: '灵巧', instinct: '本能', presence: '风度', knowledge: '知识',
  primaryWeaponName: '主武器', primaryWeaponTrait: '主武器属性', primaryWeaponRange: '主武器攻击距离', primaryWeaponDistance: '主武器攻击距离', primaryWeaponDamage: '主武器伤害', primaryWeaponFeature: '主武器特性',
  secondaryWeaponName: '副武器', secondaryWeaponTrait: '副武器属性', secondaryWeaponRange: '副武器攻击距离', secondaryWeaponDistance: '副武器攻击距离', secondaryWeaponDamage: '副武器伤害', secondaryWeaponFeature: '副武器特性',
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

function label(key: string): string {
  return labels[key] ?? key
}

// ===== SOURCE DETAILS FALLBACK =====
function sourceFields(value: unknown, path: string[] = []): Array<[string, string]> {
  if (Array.isArray(value)) return value.flatMap((item, index) => sourceFields(item, [...path, String(index + 1)]))
  const nested = record(value)
  if (nested) return Object.entries(nested).flatMap(([key, item]) => sourceFields(item, [...path, label(key)]))
  const shown = scalar(value)
  return shown === null ? [] : [[path.join(' › '), shown]]
}

// ===== MAIN COMPONENT =====
export default function ReadOnlyCharacterSheet({ sheet: originalSheet, resources, onGoldChange, disabled = false }: { sheet: CharacterSheetJson; resources: CharacterResources; onGoldChange?: (index: number, marked: boolean) => void; disabled?: boolean }) {
  const view = originalSheet.desktopView
  const sheet = view ? {
    ...originalSheet,
    evasion: view.evasion,
    armorValue: view.armorValue,
    minorThreshold: view.minorThreshold,
    majorThreshold: view.majorThreshold,
    ...Object.fromEntries(Object.entries(view.attributes ?? {}).map(([key, value]) => [key, { ...(record(originalSheet[key]) ?? {}), value }])),
    primaryWeaponRange: view.primaryWeaponRange,
    secondaryWeaponRange: view.secondaryWeaponRange,
  } : originalSheet
  // 1. Tags
  const professionName = scalar(sheet.professionRef && typeof sheet.professionRef === 'object' && 'name' in sheet.professionRef ? sheet.professionRef.name : sheet.profession)
  const subclassName = scalar(sheet.subclassRef && typeof sheet.subclassRef === 'object' && 'name' in sheet.subclassRef ? sheet.subclassRef.name : sheet.subclass)
  const ancestry1 = scalar(sheet.ancestry1Ref && typeof sheet.ancestry1Ref === 'object' && 'name' in sheet.ancestry1Ref ? sheet.ancestry1Ref.name : sheet.ancestry1)
  const community = scalar(sheet.communityRef && typeof sheet.communityRef === 'object' && 'name' in sheet.communityRef ? sheet.communityRef.name : sheet.community)
  const levelNum = scalar(sheet.level) ?? '1'

  // 2. Proficiency & Experience
  const profArray: boolean[] = Array.isArray(sheet.proficiency) ? sheet.proficiency.map(Boolean) : []
  const experiences = list(sheet.experience)
  const expValues = list(sheet.experienceValues)

  // 3. Hope Feature Extraction
  let hopeContent: string | null = null
  if (Array.isArray(sheet.cards)) {
    const profCard = sheet.cards.find(c => c && typeof c === 'object' && 'type' in c && c.type === 'profession') as SheetRecord | undefined
    if (profCard) {
      const special = record(profCard.professionSpecial)
      if (special && special['希望特性']) {
        hopeContent = scalar(special['希望特性'])
      }
    }
  }

  // 4. Cards
  const filterValidCards = (raw: unknown) => {
    if (!Array.isArray(raw)) return []
    return raw.map(record).filter((c): c is SheetRecord => {
      if (!c) return false
      const id = String(c.id ?? '')
      const name = scalar(c.name)
      return !id.startsWith('empty-') && Boolean(name)
    })
  }

  const activeCards = filterValidCards(sheet.cards)
  const vaultCards = filterValidCards(sheet.inventory_cards)

  // 5. Inventory Items
  const inventoryItems = list(sheet.inventory).filter(Boolean)

  return (
    <article className="sheet-swiss-root">
      {/* 头部身份区 */}
      <section className="sheet-hero-box">
        <h2 className="sheet-hero-name">{sheet.name}</h2>
        <div className="sheet-hero-tags">
          {professionName && <span className="sheet-tag">{professionName}</span>}
          {subclassName && <span className="sheet-tag">{subclassName}</span>}
          {ancestry1 && <span className="sheet-tag">{ancestry1}</span>}
          {community && <span className="sheet-tag">{community}</span>}
          <span className="sheet-tag sheet-tag--level">{levelNum} 级</span>
        </div>
      </section>

      {/* 熟练度与金币 (双列) */}
      <div className="sheet-grid-2">
        {/* 熟练度与经历 */}
        <section className="sheet-block">
          <header className="sheet-block__head">
            <h3 className="sheet-block__title">熟练度与经历</h3>
          </header>
          <div className="sheet-block__body">
            <div className="sheet-prof-container">
              <div className="sheet-prof-row">
                <span className="sheet-prof-title">熟练值</span>
                <div className="sheet-prof-slots">
                  {[1, 2, 3, 4, 5, 6].map((lvl, idx) => {
                    const active = profArray[idx] ?? (typeof sheet.proficiency === 'number' && sheet.proficiency >= lvl)
                    return (
                      <div key={lvl} className={`sheet-prof-slot ${active ? 'active' : ''}`}>
                        {lvl}
                      </div>
                    )
                  })}
                </div>
              </div>
              <table className="sheet-exp-table">
                <thead>
                  <tr>
                    <th>经历</th>
                    <th style={{ textAlign: 'right' }}>加值</th>
                  </tr>
                </thead>
                <tbody>
                  {experiences.length > 0 ? (
                    experiences.map((exp, i) => (
                      <tr key={i}>
                        <td className="sheet-exp-name">{exp}</td>
                        <td className="sheet-exp-val">{expValues[i] ? `+${expValues[i]}` : '+0'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="sheet-muted-text">无登记经历</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 金币存量 */}
        <section className="sheet-block">
          <header className="sheet-block__head">
            <h3 className="sheet-block__title">金币存量</h3>
          </header>
          <div className="sheet-block__body">
            <GoldInteractive gold={resources.gold} initialGold={sheet.gold} onChange={onGoldChange} disabled={disabled} />
          </div>
        </section>
      </div>

      {/* 武器与护甲配置 */}
      <section className="sheet-block">
        <header className="sheet-block__head">
          <h3 className="sheet-block__title">武器与护甲配置</h3>
        </header>
        <div className="sheet-block__body">
          <div className="sheet-weapons-grid">
            <WeaponCard slot="主手" name={sheet.primaryWeaponName} trait={sheet.primaryWeaponTrait} damage={sheet.primaryWeaponDamage} feature={sheet.primaryWeaponFeature} />
            <WeaponCard slot="副手" name={sheet.secondaryWeaponName} trait={sheet.secondaryWeaponTrait} damage={sheet.secondaryWeaponDamage} feature={sheet.secondaryWeaponFeature} />
            <ArmorCard name={sheet.armorName} baseScore={sheet.armorBaseScore} threshold={sheet.armorThreshold} feature={sheet.armorFeature} />
          </div>

          {Boolean(scalar(sheet.inventoryWeapon1Name) || scalar(sheet.inventoryWeapon2Name)) && (
            <div className="sheet-backup-wrapper">
              <h4 className="sheet-backup-heading">备用武器栏位</h4>
              <div className="sheet-backup-grid">
                {scalar(sheet.inventoryWeapon1Name) && (
                  <WeaponCard slot="备用 1" name={sheet.inventoryWeapon1Name} trait={sheet.inventoryWeapon1Trait} damage={sheet.inventoryWeapon1Damage} feature={sheet.inventoryWeapon1Feature} />
                )}
                {scalar(sheet.inventoryWeapon2Name) && (
                  <WeaponCard slot="备用 2" name={sheet.inventoryWeapon2Name} trait={sheet.inventoryWeapon2Trait} damage={sheet.inventoryWeapon2Damage} feature={sheet.inventoryWeapon2Feature} />
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 库存物品栏 */}
      <section className="sheet-block">
        <header className="sheet-block__head">
          <h3 className="sheet-block__title">库存物品栏</h3>
        </header>
        <div className="sheet-block__body">
          {inventoryItems.length > 0 ? (
            <div className="sheet-inv-grid">
              {inventoryItems.map((item, idx) => (
                <div key={idx} className="sheet-inv-item">
                  <span className="sheet-inv-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="sheet-inv-text">{item}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="sheet-muted-text">暂无库存物品</div>
          )}
        </div>
      </section>

      {/* 背景设定 (三列) */}
      <section className="sheet-block">
        <header className="sheet-block__head">
          <h3 className="sheet-block__title">背景设定</h3>
        </header>
        <div className="sheet-block__body" style={{ padding: 0 }}>
          <div className="sheet-backstory-grid">
            <div className="sheet-backstory-col">
              <header className="sheet-backstory-head">
                <span className="sheet-backstory-title">背景</span>
              </header>
              <div className="sheet-backstory-body">
                {scalar(sheet.characterBackground) ? <p>{scalar(sheet.characterBackground)}</p> : <span className="sheet-muted-text">（未填写背景）</span>}
              </div>
            </div>
            <div className="sheet-backstory-col">
              <header className="sheet-backstory-head">
                <span className="sheet-backstory-title">外貌</span>
              </header>
              <div className="sheet-backstory-body">
                {scalar(sheet.characterAppearance) ? <p>{scalar(sheet.characterAppearance)}</p> : <span className="sheet-muted-text">（未填写外貌）</span>}
              </div>
            </div>
            <div className="sheet-backstory-col">
              <header className="sheet-backstory-head">
                <span className="sheet-backstory-title">动机</span>
              </header>
              <div className="sheet-backstory-body">
                {scalar(sheet.characterMotivation) ? <p>{scalar(sheet.characterMotivation)}</p> : <span className="sheet-muted-text">（未填写动机）</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 希望特性 */}
      {hopeContent && (
        <section className="sheet-block">
          <header className="sheet-block__head">
            <h3 className="sheet-block__title">希望特性</h3>
          </header>
          <div className="sheet-block__body">
            <div className="sheet-hope-card">
              <MarkdownContent content={hopeContent} />
            </div>
          </div>
        </section>
      )}

      {/* 配置卡组 */}
      <section className="sheet-block">
        <header className="sheet-block__head">
          <h3 className="sheet-block__title">配置卡组</h3>
        </header>
        <div className="sheet-block__body">
          {activeCards.length > 0 ? (
            <div className="sheet-cards-grid">
              {activeCards.map((card, i) => {
                const typeStr = String(card.type ?? '')
                const typeConf = TYPE_CONFIG[typeStr] ?? { label: '卡牌', cls: '' }
                const classStr = scalar(card.class)
                const descStr = scalar(card.description)
                return (
                  <article key={String(card.id ?? i)} className="sheet-card-cell">
                    <header className="sheet-card-cell__head">
                      <h4 className="sheet-card-cell__title">{scalar(card.name)}</h4>
                      <span className={`sheet-card-chip ${typeConf.cls}`}>{typeConf.label}</span>
                    </header>
                    {classStr && <div className="sheet-card-cell__sub">{classStr}</div>}
                    <div className="sheet-card-cell__body">
                      {descStr && <MarkdownContent content={descStr} />}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="sheet-muted-text">配置卡组为空</div>
          )}
        </div>
      </section>

      {/* 宝库卡组 */}
      <section className="sheet-block">
        <header className="sheet-block__head">
          <h3 className="sheet-block__title">宝库卡组</h3>
        </header>
        <div className="sheet-block__body">
          {vaultCards.length > 0 ? (
            <div className="sheet-cards-grid">
              {vaultCards.map((card, i) => {
                const typeStr = String(card.type ?? '')
                const typeConf = TYPE_CONFIG[typeStr] ?? { label: '卡牌', cls: '' }
                const classStr = scalar(card.class)
                const descStr = scalar(card.description)
                return (
                  <article key={String(card.id ?? i)} className="sheet-card-cell">
                    <header className="sheet-card-cell__head">
                      <h4 className="sheet-card-cell__title">{scalar(card.name)}</h4>
                      <span className={`sheet-card-chip ${typeConf.cls}`}>{typeConf.label}</span>
                    </header>
                    {classStr && <div className="sheet-card-cell__sub">{classStr}</div>}
                    <div className="sheet-card-cell__body">
                      {descStr && <MarkdownContent content={descStr} />}
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="sheet-empty-vault">— 宝库卡组暂无待命卡牌 —</div>
          )}
        </div>
      </section>

      {/* 完整角色字段（未排版拓展明细，满足数据完整性及测试断言） */}
      <details className="sheet-source-details">
        <summary>完整角色字段（含未单独排版的字段）</summary>
        <dl>
          {sourceFields(sheet).map(([name, value], index) => (
            <div key={`${name}-${index}`}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  )
}
