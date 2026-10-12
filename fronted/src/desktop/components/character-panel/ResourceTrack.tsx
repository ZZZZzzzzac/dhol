import type { TrackResource } from '@dhgc/shared/desktop'

const labels: Record<TrackResource, string> = { hp: '生命', stress: '压力', armor: '护甲槽', gold: '金币' }

export default function ResourceTrack({ resource, marks, disabled, onChange }: {
  resource: TrackResource
  marks: boolean[]
  disabled: boolean
  onChange: (index: number, marked: boolean) => void
}) {
  const label = labels[resource]
  return <div className="resource-track">
    <div className="resource-track__label"><strong>{label}</strong><span>{marks.filter(Boolean).length} / {marks.length} 已标记</span></div>
    <div className="resource-track__marks" role="group" aria-label={`${label}标记`}>
      {marks.map((marked, index) => <button key={index} type="button" className="resource-mark" disabled={disabled}
        aria-pressed={marked} aria-label={`${label}第 ${index + 1} 格，${marked ? '已标记' : '未标记'}`}
        onClick={() => onChange(index, !marked)}><span aria-hidden="true">{marked ? '×' : index + 1}</span></button>)}
    </div>
  </div>
}
