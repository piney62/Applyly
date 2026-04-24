import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { useAuthStore } from '../store/authStore'

interface Props { navigate: (screen: string) => void }

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </p>
  )
}

function LockedRow({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', opacity: 0.4 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#9CA3AF' }}>🔒 Coming soon</span>
    </div>
  )
}

export function S09_Settings({ navigate }: Props) {
  const { user, logout } = useAuthStore()
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('applyly-theme')
    if (stored === 'dark') {
      setDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  function toggleDark() {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('applyly-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('applyly-theme', 'light')
    }
  }

  function handleLogout() {
    logout()
    navigate('S01')
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Appearance */}
        <div>
          <SectionHeader>Appearance</SectionHeader>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <span style={{ fontSize: 13 }}>Dark mode</span>
            <button
              onClick={toggleDark}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: dark ? '#534AB7' : '#E5E7EB',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 150ms',
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: dark ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'white',
                transition: 'left 150ms',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
        </div>

        {/* AI — locked */}
        <div>
          <SectionHeader>AI</SectionHeader>
          <LockedRow label="AI Provider" />
          <LockedRow label="Cover letter tone" />
          <LockedRow label="Answer length" />
        </div>

        {/* Automation — locked */}
        <div>
          <SectionHeader>Automation</SectionHeader>
          <LockedRow label="Auto-fill speed" />
          <LockedRow label="Pause on AI fields" />
        </div>

        {/* Platforms — locked */}
        <div>
          <SectionHeader>Platforms</SectionHeader>
          <LockedRow label="Indeed" />
          <LockedRow label="Workday" />
          <LockedRow label="Greenhouse" />
          <LockedRow label="Lever" />
        </div>

        {/* Account */}
        <div>
          <SectionHeader>Account</SectionHeader>
          <div style={{ padding: '8px 0', fontSize: 13 }}>
            <div style={{ fontWeight: 500, color: '#111827' }}>{user?.name ?? '—'}</div>
            <div style={{ color: '#6B7280', marginTop: 2 }}>{user?.email ?? '—'}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              marginTop: 8,
              background: 'white',
              border: '1.5px solid #E5E7EB',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Log Out
          </button>
        </div>
      </div>
      <BottomNav active="settings" navigate={navigate} />
    </div>
  )
}
