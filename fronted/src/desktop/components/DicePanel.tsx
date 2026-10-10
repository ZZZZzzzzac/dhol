import { useState } from 'react'
import type { DiceRollRecord, DiceRollRequest } from '@dhgc/shared/desktop'

export default function DicePanel({ dice, ready, pending, onRoll, onClear }: { dice: DiceRollRecord[]; ready: boolean; pending: boolean; onRoll: (request: DiceRollRequest) => void; onClear: () => void }) {
  const [sides, setSides] = useState(20)
  const [count, setCount] = useState(1)
  const [modifier, setModifier] = useState(0)
  const [mode, setMode] = useState<DiceRollRequest['mode']>('standard')
  const [modifierMode, setModifierMode] = useState<DiceRollRequest['modifier_mode']>('normal')
  const roll = () => onRoll({ mode, modifier_mode: modifierMode, repeat: 1, modifier, dice: [{ sides, count }] })
  return <section className="dice-panel" aria-labelledby="dice-title">
    <header><div><p>由服务器生成并保存结果</p><h2 id="dice-title">掷骰</h2></div>{dice.length > 0 && <button type="button" className="button button--ghost" disabled={!ready} onClick={onClear}>清空记录</button>}</header>
    <div className="dice-builder"><label>模式<select value={mode} onChange={event => setMode(event.target.value as DiceRollRequest['mode'])}><option value="standard">标准</option><option value="dual">希望 / 恐惧双骰</option></select></label><label>数量<input type="number" min="1" max="20" value={count} onChange={event => setCount(Math.max(1, Math.min(20, Number(event.target.value))))} /></label><label>面数<select value={sides} onChange={event => setSides(Number(event.target.value))}>{[4, 6, 8, 10, 12, 20, 100].map(value => <option key={value} value={value}>d{value}</option>)}</select></label><label>修正<input type="number" min="-99" max="99" value={modifier} onChange={event => setModifier(Math.max(-99, Math.min(99, Number(event.target.value))))} /></label><label>优势<select value={modifierMode} onChange={event => setModifierMode(event.target.value as DiceRollRequest['modifier_mode'])}><option value="normal">普通</option><option value="advantage">优势</option><option value="disadvantage">劣势</option></select></label><button type="button" className="button button--primary dice-roll" disabled={!ready || pending} onClick={roll}>{pending ? '掷骰中…' : `掷 ${count}d${sides}`}</button></div>
    <div className="dice-history" aria-live="polite">{dice.length === 0 ? <p className="muted">暂无掷骰记录。</p> : dice.slice().reverse().map(item => <article key={item.id}><div><strong>{item.actor_name}</strong><span>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><p>{item.normalized_formula}</p><b>{item.results.map(result => result.total).join('、')}</b>{item.results[0]?.outcome && <em>{item.results[0].outcome === 'hope' ? '希望' : item.results[0].outcome === 'fear' ? '恐惧' : '大成功'}</em>}</article>)}</div>
  </section>
}
