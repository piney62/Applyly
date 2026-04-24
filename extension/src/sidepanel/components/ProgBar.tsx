interface ProgBarProps {
  value: number
  color?: string
}

function scoreColor(v: number): string {
  if (v >= 75) return '#1D9E75'
  if (v >= 50) return '#EF9F27'
  return '#E24B4A'
}

export function ProgBar({ value, color }: ProgBarProps) {
  const fill = color ?? scoreColor(value)
  return (
    <div
      style={{
        height: 6,
        background: '#F3F4F6',
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: fill,
          borderRadius: 999,
          transition: 'width 600ms ease',
        }}
      />
    </div>
  )
}
