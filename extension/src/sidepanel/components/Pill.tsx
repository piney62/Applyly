import { ReactNode } from 'react'

type PillColor = 'green' | 'red' | 'amber' | 'gray' | 'blue' | 'purple'

const colorMap: Record<PillColor, { bg: string; text: string; dot?: string }> = {
  green:  { bg: '#E7F6F1', text: '#1D9E75', dot: '#1D9E75' },
  red:    { bg: '#FDEAEA', text: '#E24B4A', dot: '#E24B4A' },
  amber:  { bg: '#FEF5E7', text: '#EF9F27', dot: '#EF9F27' },
  gray:   { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
  blue:   { bg: '#EFF6FF', text: '#3B82F6', dot: '#3B82F6' },
  purple: { bg: '#EEEEF9', text: '#534AB7', dot: '#534AB7' },
}

interface PillProps {
  color: PillColor
  dot?: boolean
  children: ReactNode
}

export function Pill({ color, dot, children }: PillProps) {
  const c = colorMap[color]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: c.bg,
        color: c.text,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: c.dot,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  )
}
