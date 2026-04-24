export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#534AB7" />
        <rect x="6" y="17" width="4" height="6" rx="1" fill="white" />
        <rect x="12" y="12" width="4" height="11" rx="1" fill="white" />
        <rect x="18" y="7" width="4" height="16" rx="1" fill="white" />
      </svg>
      <span style={{ fontWeight: 600, fontSize: 16, color: '#534AB7', letterSpacing: '-0.3px' }}>
        Applyly
      </span>
    </div>
  )
}
