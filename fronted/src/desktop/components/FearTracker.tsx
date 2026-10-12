export default function FearTracker({ value, max, ready, onChange }: {
  value: number
  max: number
  ready: boolean
  onChange: (delta: 1 | -1) => void
}) {
  const pips = Array.from({ length: max }, (_, i) => i < value)

  const handlePreset = (target: number) => {
    const diff = target - value
    if (diff > 0) {
      for (let i = 0; i < diff; i++) onChange(1)
    } else if (diff < 0) {
      for (let i = 0; i < Math.abs(diff); i++) onChange(-1)
    }
  }

  return <section className="fear-card" aria-labelledby="fear-title">
    <div className="fear-top">
      <h3 id="fear-title" className="fear-title">恐惧</h3>
    </div>
    <div className="fear-val-row">
      <div className="fear-num">{value}</div>
      <div className="fear-max">/ {max}</div>
    </div>
    <div className="fear-pips">
      {pips.map((filled, i) => <div key={i} className={`fear-pip ${filled ? 'filled' : ''}`} />)}
    </div>
    <div className="fear-actions">
      <button type="button" className="fear-btn" disabled={!ready || value === 0} onClick={() => onChange(-1)}>− 1</button>
      <button type="button" className="fear-btn fear-btn--plus" disabled={!ready || value === max} onClick={() => onChange(1)}>+ 1</button>
    </div>
    <div className="fear-presets">
      <button type="button" disabled={!ready || value === 0} onClick={() => handlePreset(0)}>0</button>
      <button type="button" disabled={!ready || value >= max} onClick={() => handlePreset(Math.min(max, value + 2))}>+2</button>
      <button type="button" disabled={!ready || value >= max} onClick={() => handlePreset(Math.min(max, value + 4))}>+4</button>
      <button type="button" disabled={!ready || value === max} onClick={() => handlePreset(max)}>{max}</button>
    </div>
  </section>
}
