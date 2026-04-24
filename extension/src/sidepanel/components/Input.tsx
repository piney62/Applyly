import { useState } from 'react'

interface InputProps {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
}

export function Input({ label, type = 'text', value, onChange, placeholder, autoComplete }: InputProps) {
  const [focused, setFocused] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const isPw = type === 'password'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          type={isPw && showPw ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            height: 42,
            border: 'none',
            borderBottom: `2px solid ${focused ? '#534AB7' : '#E5E7EB'}`,
            outline: 'none',
            fontSize: 14,
            fontFamily: 'inherit',
            background: 'transparent',
            paddingRight: isPw ? 36 : 0,
            transition: 'border-color 150ms',
            boxSizing: 'border-box',
          }}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#9CA3AF',
              fontSize: 12,
              padding: '0 4px',
            }}
          >
            {showPw ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  )
}
