export default function XCard({ active, ready, onChange }: { active: boolean; ready: boolean; onChange: (active: boolean) => void }) {
  return <section className={`utility-card x-card${active ? ' x-card--active' : ''}`} aria-labelledby="xcard-title"><div><p>安全工具</p><h2 id="xcard-title">X 卡</h2></div><button type="button" className="x-card__button" disabled={!ready} aria-pressed={active} onClick={() => onChange(!active)}>{active ? '已举起 · 点击解除' : '需要暂停时举起 X 卡'}</button></section>
}
