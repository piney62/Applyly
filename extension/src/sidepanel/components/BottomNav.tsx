type Tab = 'apply' | 'tracker' | 'settings'

interface BottomNavProps {
  active: Tab
  navigate: (screen: string) => void
}

const tabs: { id: Tab; label: string; screen: string; icon: string }[] = [
  { id: 'apply',    label: 'Apply',    screen: 'S03', icon: '⚡' },
  { id: 'tracker',  label: 'Tracker',  screen: 'S08', icon: '📋' },
  { id: 'settings', label: 'Settings', screen: 'S09', icon: '⚙️' },
]

export function BottomNav({ active, navigate }: BottomNavProps) {
  return (
    <nav
      style={{
        display: 'flex',
        borderTop: '1px solid #E5E7EB',
        background: 'white',
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.screen)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '10px 0',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? '#534AB7' : '#9CA3AF',
              fontSize: 10,
              fontWeight: isActive ? 600 : 400,
              fontFamily: 'inherit',
              borderTop: `2px solid ${isActive ? '#534AB7' : 'transparent'}`,
              transition: 'color 150ms',
            }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
