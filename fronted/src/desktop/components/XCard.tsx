export default function XCard({ active, ready, onChange }: { active: boolean; ready: boolean; onChange: (active: boolean) => void }) {
  return <button
    type="button"
    className={`btn-xcard ${active ? 'active' : ''}`}
    disabled={!ready}
    aria-pressed={active}
    onClick={() => onChange(!active)}
  >
    {active ? 'X卡已激活' : 'X卡'}
  </button>
}
