import { useState } from 'react'
import type { DiceModifierMode, DiceRollRecord, DiceRollRequest } from '@dhgc/shared/desktop'

export interface RoomLogItem {
  text: string
  time: string
  tag?: string
}

function rolledDiceText(record: DiceRollRecord): string {
  const result = record.results[0]
  if (!result) return ''
  const pieces = record.mode === 'dual'
    ? [`希望[${result.hope}]`, `恐惧[${result.fear}]`]
    : []
  pieces.push(...result.terms.map(term => `${term.notation}[${term.rolls.join(', ')}]`))
  let text = pieces.join(' + ')
  if (result.advantage_roll !== undefined && record.mode === 'dual') {
    const rolls = result.advantage_rolls ?? [result.advantage_roll]
    const label = `${rolls.length}d6[${rolls.join(', ')}]取高${result.advantage_roll}`
    text += ` ${record.modifier_mode === 'disadvantage' ? '−' : '+'} ${label}`
  }
  if (record.request.modifier !== 0) text += ` ${record.request.modifier > 0 ? '+' : '−'} ${Math.abs(record.request.modifier)}`
  return text
}

export default function DicePanel({
  dice,
  ready,
  pending,
  onRoll,
  onClear,
  roomLog = [],
  onClearRoomLog
}: {
  dice: DiceRollRecord[]
  ready: boolean
  pending: boolean
  onRoll: (request: DiceRollRequest) => void
  onClear: () => void
  roomLog?: RoomLogItem[]
  onClearRoomLog?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'dual' | 'standard'>('dual')
  const [standardDice, setStandardDice] = useState<Array<{ sides: number; count: number }>>([])
  const [modifier, setModifier] = useState(0)
  const [dualAdvantage, setDualAdvantage] = useState<{ mode: DiceModifierMode; count: number }>({ mode: 'normal', count: 0 })
  const standardFormula = standardDice.map(({ sides, count }) => `${count}d${sides}`).join(' + ')
    + (modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '')

  const latestDualRecord = dice.slice().reverse().find(d => d.mode === 'dual')
  const latestDual = latestDualRecord?.results[0]
  const latestStd = dice.slice().reverse().find(d => d.mode === 'standard')
  const currentMatchesLatestStd = latestStd?.request.modifier === modifier
    && latestStd.request.dice.length === standardDice.length
    && standardDice.every(entry => latestStd.request.dice.some(rolled => rolled.sides === entry.sides && rolled.count === entry.count))

  const rollDual = () => {
    onRoll({
      mode: 'dual',
      modifier_mode: dualAdvantage.mode,
      ...(dualAdvantage.count ? { advantage_count: dualAdvantage.count } : {}),
      repeat: 1,
      modifier,
      dice: []
    })
  }

  const changeDualAdvantage = (mode: 'advantage' | 'disadvantage', delta: 1 | -1) => {
    setDualAdvantage(current => {
      if (current.mode !== mode) return delta > 0 ? { mode, count: 1 } : current
      const count = Math.max(0, Math.min(100, current.count + delta))
      return { mode: count ? mode : 'normal', count }
    })
  }

  const rollStd = () => {
    onRoll({
      mode: 'standard',
      modifier_mode: 'normal',
      repeat: 1,
      modifier,
      dice: standardDice
    })
  }

  const changeStandardDie = (sides: number, delta: 1 | -1) => {
    setStandardDice(current => {
      const existing = current.find(entry => entry.sides === sides)
      if (!existing) return delta > 0 ? [...current, { sides, count: 1 }] : current
      const count = Math.max(0, Math.min(100, existing.count + delta))
      return count === 0
        ? current.filter(entry => entry.sides !== sides)
        : current.map(entry => entry.sides === sides ? { sides, count } : entry)
    })
  }

  return <section className="dice-section" aria-labelledby="dice-title">
    <div className="section-head">
      <h2 id="dice-title" className="section-title">掷骰</h2>
    </div>

    <div className="dice-layout">
      {/* 左栏：房间记录 */}
      <div className="history-card">
        <div className="history-head">
          <h4 className="history-title">房间记录</h4>
          {onClearRoomLog && <button type="button" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={onClearRoomLog}>清空</button>}
        </div>
        <div className="history-scroll">
          {roomLog.length === 0 ? (
            <div style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: '20px' }}>暂无记录</div>
          ) : (
            roomLog.map((item, i) => (
              <div key={i} className="history-item">
                <div className="hist-top">
                  <span className="hist-name">{item.text}</span>
                  <span className="hist-time">{item.time}</span>
                </div>
                {item.tag && <div style={{ color: 'var(--ink-muted)', fontSize: '11px' }}>{item.tag}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 中栏：掷骰控制板 */}
      <div className="dice-box">
        <div className="dice-tabs-bar">
          <button
            type="button"
            className={`dice-tab-btn ${activeTab === 'dual' ? 'active' : ''}`}
            onClick={() => setActiveTab('dual')}
          >
            二元骰
          </button>
          <button
            type="button"
            className={`dice-tab-btn ${activeTab === 'standard' ? 'active' : ''}`}
            onClick={() => setActiveTab('standard')}
          >
            普通骰
          </button>
        </div>

        {activeTab === 'dual' ? (
          <div className="dice-body dice-body--dual">
            <div className="duality-board">
              <div className="duality-card duality-card--hope">
                <div className="duality-card-name">希望</div>
                <div className="duality-card-num">{latestDual?.hope ?? '--'}</div>
              </div>
              <div className="duality-card duality-card--fear">
                <div className="duality-card-name">恐惧</div>
                <div className="duality-card-num">{latestDual?.fear ?? '--'}</div>
              </div>
            </div>

            <div className="dice-controls">
              <div className="param-unit">
                <label className="param-label" htmlFor="duality-mod">加值</label>
                <div className="dual-modifier-row">
                  <input
                    id="duality-mod"
                    type="number"
                    value={modifier}
                    onChange={e => setModifier(Number(e.target.value) || 0)}
                  />
                  {(['advantage', 'disadvantage'] as const).map(mode => {
                    const count = dualAdvantage.mode === mode ? dualAdvantage.count : 0
                    const label = mode === 'advantage' ? '优势' : '劣势'
                    return <button
                      key={mode}
                      type="button"
                      className={count ? 'dual-advantage-btn active' : 'dual-advantage-btn'}
                      onClick={() => changeDualAdvantage(mode, 1)}
                      onContextMenu={e => { e.preventDefault(); changeDualAdvantage(mode, -1) }}
                      aria-pressed={count > 0}
                      aria-label={`${label}，当前 ${count} 枚 d6；左键增加，右键减少`}
                    >{label}{count > 0 ? ` ${count}` : ''}</button>
                  })}
                </div>
              </div>
              <div className="dice-modifier-presets">
                {[2, 3, 5].map(value => <button key={value} type="button" onClick={() => setModifier(current => current + value)}>+{value}</button>)}
              </div>
              <button
                type="button"
                className="btn-roll-main"
                disabled={!ready || pending}
                onClick={rollDual}
              >
                {pending ? '掷骰中…' : '掷骰'}
              </button>
            </div>
            <div className="result-banner">
              {latestDual && latestDualRecord && (
                <>
                  <div>
                    <div className={`result-verdict ${latestDual.critical ? 'crit' : latestDual.outcome === 'hope' ? 'hope' : 'fear'}`}>
                      {latestDual.critical ? '关键成功' : latestDual.outcome === 'hope' ? '希望结果' : '恐惧结果'}
                    </div>
                    <div className="result-formula">{rolledDiceText(latestDualRecord)}</div>
                  </div>
                  <div className="result-total">{latestDual.total}</div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="dice-body dice-body--standard">
            <div className="std-sides-row">
              {[4, 6, 8, 10, 12, 20, 100].map(s => {
                const count = standardDice.find(entry => entry.sides === s)?.count ?? 0
                return (
                <button
                  key={s}
                  type="button"
                  className={`std-side-btn ${count > 0 ? 'active' : ''}`}
                  onClick={() => changeStandardDie(s, 1)}
                  onContextMenu={e => { e.preventDefault(); changeStandardDie(s, -1) }}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); changeStandardDie(s, -1) }
                    if (e.key === 'ArrowUp') { e.preventDefault(); changeStandardDie(s, 1) }
                  }}
                  aria-label={`d${s}，当前 ${count} 枚；左键或上方向键增加，右键或下方向键减少`}
                >
                  d{s}
                  {count > 0 && <span className="std-side-count" aria-hidden="true">{count}</span>}
                </button>
                )
              })}
            </div>
            <div className="dice-workspace">
              <div className="dice-controls">
              <div className="param-unit">
                <label className="param-label" htmlFor="std-mod">加值</label>
                <input
                  id="std-mod"
                  type="number"
                  value={modifier}
                  onChange={e => setModifier(Number(e.target.value) || 0)}
                />
              </div>
              <div className="dice-modifier-presets">
                {[2, 3, 5].map(value => <button key={value} type="button" onClick={() => setModifier(current => current + value)}>+{value}</button>)}
              </div>
            <button
              type="button"
              className="btn-roll-main"
              disabled={!ready || pending || standardDice.length === 0}
              onClick={rollStd}
            >
              {pending ? '掷骰中…' : '掷骰'}
            </button>
              </div>
              <div className="std-result-box">
                <div className="std-total-num">{latestStd ? latestStd.results.map(r => r.total).join('、') : '—'}</div>
                <div className="std-breakdown-txt">{currentMatchesLatestStd ? standardFormula : latestStd?.normalized_formula ?? (standardDice.length ? standardFormula : '请选择骰子')}</div>
                {latestStd && !currentMatchesLatestStd && <div className="std-current-formula" aria-live="polite">当前公式：{standardDice.length ? standardFormula : '请选择骰子'}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 右栏：掷骰记录 */}
      <div className="history-card">
        <div className="history-head">
          <h4 className="history-title">掷骰记录</h4>
          {dice.length > 0 && (
            <button type="button" disabled={!ready} style={{ padding: '4px 8px', fontSize: '12px' }} onClick={onClear}>
              清空
            </button>
          )}
        </div>
        <div className="history-scroll">
          {dice.length === 0 ? (
            <div style={{ color: 'var(--ink-muted)', textAlign: 'center', padding: '20px' }}>暂无记录</div>
          ) : (
            dice.slice().reverse().map(item => {
              const res = item.results[0]
              let tagText = ''
              let tagClass = ''
              if (res) {
                if (res.critical) {
                  tagText = '关键成功'
                  tagClass = 'hist-tag--crit'
                } else if (res.outcome === 'hope') {
                  tagText = '希望结果'
                  tagClass = 'hist-tag--hope'
                } else if (res.outcome === 'fear') {
                  tagText = '恐惧结果'
                  tagClass = 'hist-tag--fear'
                }
              }
              return (
                <div key={item.id} className="history-item">
                  <div className="hist-top">
                    <span className="hist-name">{item.actor_name}</span>
                    <span className="hist-time">
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div className="hist-bottom">
                    <span className="hist-formula">{rolledDiceText(item)}</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      {tagText && <span className={`hist-tag ${tagClass}`}>{tagText}</span>}
                      <span className="hist-val">{item.results.map(r => r.total).join('、')}</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  </section>
}
