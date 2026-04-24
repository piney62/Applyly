import { CSSProperties, ReactNode } from 'react'

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type BtnSize = 'md' | 'sm'

const styles: Record<BtnKind, CSSProperties> = {
  primary: { background: '#534AB7', color: 'white', border: 'none' },
  secondary: { background: 'white', color: '#534AB7', border: '1.5px solid #534AB7' },
  ghost: { background: 'transparent', color: '#6B7280', border: 'none' },
  danger: { background: 'white', color: '#E24B4A', border: '1.5px solid #E24B4A' },
  success: { background: '#1D9E75', color: 'white', border: 'none' },
}

interface BtnProps {
  kind?: BtnKind
  size?: BtnSize
  disabled?: boolean
  fullWidth?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  children: ReactNode
}

export function Btn({
  kind = 'primary',
  size = 'md',
  disabled = false,
  fullWidth = false,
  onClick,
  type = 'button',
  children,
}: BtnProps) {
  const height = size === 'md' ? 44 : 34
  const fontSize = size === 'md' ? 14 : 12
  const px = size === 'md' ? 20 : 14

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles[kind],
        height,
        fontSize,
        fontWeight: 500,
        paddingLeft: px,
        paddingRight: px,
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        width: fullWidth ? '100%' : undefined,
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'opacity 150ms, background 150ms',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
