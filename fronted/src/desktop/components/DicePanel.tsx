import { useState } from 'react'
import type { DiceRollRecord, DiceRollRequest } from '@dhgc/shared/desktop'

export interface RoomLogItem {
  text: string
  time: string
  tag?: string
}

function parseExtraDice(input: string): { dice: Array<{ sides: number; count: number }>; extraMod: number } {
  if (!input || !input.trim()) return { dice: [], extraMod: 0 }
  const cleaned = input.replace(/\s+/g, '')
  const regex = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gi
  let match: RegExpExecArray | null
  let extraMod = 0
  const dice: Array<{ sides: number; count: number }> = []

  while ((match = regex.exec(cleaned)) !== null) {
    const sign = match[1] === '-' ? -1 : 1
    if (match[3]) {
      const count = parseInt(match[2] || '1', 10) * sign
      const sides = parseInt(match[3], 10)
      if (count > 0 && [4, 6, 8, 10, 12, 20, 100].includes(sides)) {
        dice.push({ sides, count })
      }
    } else if (match[4]) {
      extraMod += sign * parseInt(match[4], 10)
    }
  }
  return { dice, extraMod }
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
  const [sides, setSides] = useState(20)
  const [count, setCount] = useState(1)
  const [modifier, setModifier] = useState(0)
  const [modifierMode, setModifierMode] = useState<DiceRollRequest['modifier_mode']>('normal')
  const [extraDiceStr, setExtraDiceStr] = useState('')

  const latestDual = dice.slice().reverse().find(d => d.mode === 'dual')?.results[0]
  const latestStd = dice.slice().reverse().find(d => d.mode === 'standard')

  const rollDual = () => {
    const parsed = parseExtraDice(extraDiceStr)
    onRoll({
      mode: 'dual',
      modifier_mode: modifierMode,
      repeat: 1,
      modifier: modifier + parsed.extraMod,
      dice: parsed.dice
    })
  }

  const rollStd = () => {
    onRoll({
      mode: 'standard',
      modifier_mode: modifierMode,
      repeat: 1,
      modifier,
      dice: [{ sides, count }]
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
          <div className="dice-body">
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

            <div className="dice-params-grid">
              <div className="param-unit">
                <label className="param-label" htmlFor="duality-mod">加值</label>
                <input
                  id="duality-mod"
                  type="number"
                  value={modifier}
                  onChange={e => setModifier(Number(e.target.value) || 0)}
                />
              </div>
              <div className="param-unit">
                <label className="param-label" htmlFor="duality-adv">优劣</label>
                <select
                  id="duality-adv"
                  value={modifierMode}
                  onChange={e => setModifierMode(e.target.value as DiceRollRequest['modifier_mode'])}
                >
                  <option value="normal">普通</option>
                  <option value="advantage">优势 (+1d6)</option>
                  <option value="disadvantage">劣势 (-1d6)</option>
                </select>
              </div>
              <div className="param-unit">
                <label className="param-label" htmlFor="duality-extra">额外骰</label>
                <input
                  id="duality-extra"
                  type="text"
                  placeholder="例如 d6+2+d8"
                  value={extraDiceStr}
                  onChange={e => setExtraDiceStr(e.target.value)}
                />
              </div>
            </div>

            <button
              type="button"
              className="btn-roll-main"
              disabled={!ready || pending}
              onClick={rollDual}
            >
              {pending ? '掷骰中…' : '掷骰'}
            </button>

            {latestDual && (
              <div className="result-banner">
                <div>
                  <div className={`result-verdict ${latestDual.critical ? 'crit' : latestDual.outcome === 'hope' ? 'hope' : 'fear'}`}>
                    {latestDual.critical ? '大成功' : latestDual.outcome === 'hope' ? '希望结果' : '恐惧结果'}
                  </div>
                  <div className="result-formula">
                    希望[{latestDual.hope}] + 恐惧[{latestDual.fear}]
                    {modifier !== 0 && (modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`)}
                  </div>
                </div>
                <div className="result-total">{latestDual.total}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="dice-body">
            <div className="std-sides-row">
              {[4, 6, 8, 10, 12, 20, 100].map(s => (
                <button
                  key={s}
                  type="button"
                  className={`std-side-btn ${sides === s ? 'active' : ''}`}
                  onClick={() => setSides(s)}
                >
                  d{s}
                </button>
              ))}
            </div>

            <div className="dice-params-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <div className="param-unit">
                <label className="param-label" htmlFor="std-count">数量</label>
                <input
                  id="std-count"
                  type="number"
                  min="1"
                  max="20"
                  value={count}
                  onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value))))}
                />
              </div>
              <div className="param-unit">
                <label className="param-label" htmlFor="std-mod">加值</label>
                <input
                  id="std-mod"
                  type="number"
                  value={modifier}
                  onChange={e => setModifier(Number(e.target.value) || 0)}
                />
              </div>
              <div className="param-unit">
                <label className="param-label" htmlFor="std-mode">模式</label>
                <select
                  id="std-mode"
                  value={modifierMode}
                  onChange={e => setModifierMode(e.target.value as DiceRollRequest['modifier_mode'])}
                >
                  <option value="normal">普通</option>
                  <option value="advantage">优势 (取高)</option>
                  <option value="disadvantage">劣势 (取低)</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn-roll-main"
              disabled={!ready || pending}
              onClick={rollStd}
            >
              {pending ? '掷骰中…' : '掷骰'}
            </button>

            {latestStd && (
              <div className="std-result-box">
                <div className="std-total-num">{latestStd.results.map(r => r.total).join('、')}</div>
                <div className="std-breakdown-txt">{latestStd.normalized_formula}</div>
              </div>
            )}
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
                  tagText = '大成功'
                  tagClass = 'hist-tag--crit'
                } else if (res.outcome === 'hope') {
                  tagText = '希望结果'
                  tagClass = 'hist-tag--hope'
                } else if (res.outcome === 'fear') {
                  tagText = '恐惧结果'
                  tagClass = 'hist-tag--fear'
                } else if (item.mode === 'standard') {
                  tagText = `d${item.request.dice[0]?.sides ?? 20}`
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
                    <span className="hist-formula">{item.normalized_formula}</span>
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
