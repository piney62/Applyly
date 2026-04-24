import { useEffect, useState } from 'react'
import { BottomNav } from '../components/BottomNav'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { api } from '../api/client'
import { useTrackerStore, Application, AppStatus } from '../store/trackerStore'

interface Props { navigate: (screen: string) => void }

const STATUSES: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'applied', label: 'Applied' },
  { value: 'phone_screen', label: 'Phone Screen' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
]

const STATUS_OPTIONS = ['applied', 'phone_screen', 'interview', 'offer', 'rejected'] as const

function StatCard({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ flex: 1, background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{count}</div>
      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export function S08_Tracker({ navigate }: Props) {
  const { applications, filterStatus, setApplications, updateStatus, setFilter } = useTrackerStore()
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.tracker
      .list()
      .then((res) => setApplications((res as { applications: Application[] }).applications))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterStatus === 'all'
    ? applications
    : applications.filter((a) => a.status === filterStatus)

  const countOf = (s: string) => applications.filter((a) => a.status === s).length

  async function handleStatusChange(id: string, status: AppStatus) {
    try {
      await api.tracker.updateStatus(id, status)
      updateStatus(id, status)
    } catch { /* silent */ }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCard label="Applied" count={countOf('applied')} />
          <StatCard label="Interview" count={countOf('interview')} />
          <StatCard label="Offer" count={countOf('offer')} />
        </div>

        {/* Filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilter(e.target.value)}
          style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'white', color: '#374151' }}
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {/* Application list */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingTop: 24 }}>
            No applications yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((app) => (
              <div
                key={app.id}
                style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}
              >
                <button
                  onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{app.company}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{app.job_title}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                      {app.applied_at ? new Date(app.applied_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <StatusBadge status={app.status} />
                </button>

                {expandedId === app.id && (
                  <div style={{ borderTop: '1px solid #F3F4F6', padding: '12px 14px', background: '#FAFAFA', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {app.cover_letter && (
                      <div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Cover letter snippet</div>
                        <div style={{ fontSize: 12, color: '#374151', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                          {app.cover_letter}
                        </div>
                      </div>
                    )}
                    {app.job_url && (
                      <a href={app.job_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#534AB7' }}>
                        View job posting ↗
                      </a>
                    )}
                    <div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Update status</div>
                      <select
                        value={app.status}
                        onChange={(e) => handleStatusChange(app.id, e.target.value as AppStatus)}
                        style={{ border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', background: 'white' }}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <BottomNav active="tracker" navigate={navigate} />
    </div>
  )
}
