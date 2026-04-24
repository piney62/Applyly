import { Pill } from './Pill'

type AppStatus = 'applied' | 'phone_screen' | 'interview' | 'offer' | 'rejected'

const statusConfig: Record<AppStatus, { label: string; color: 'gray' | 'blue' | 'amber' | 'green' | 'red' }> = {
  applied:      { label: 'Applied',       color: 'gray'  },
  phone_screen: { label: 'Phone Screen',  color: 'blue'  },
  interview:    { label: 'Interview',     color: 'amber' },
  offer:        { label: 'Offer',         color: 'green' },
  rejected:     { label: 'Rejected',      color: 'red'   },
}

export function StatusBadge({ status }: { status: AppStatus }) {
  const cfg = statusConfig[status] ?? { label: status, color: 'gray' as const }
  return (
    <Pill color={cfg.color} dot>
      {cfg.label}
    </Pill>
  )
}
