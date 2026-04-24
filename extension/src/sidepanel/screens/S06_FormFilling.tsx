import { Spinner } from '../components/Spinner'
import { ProgBar } from '../components/ProgBar'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { useFormStore, DetectedField } from '../store/formStore'

interface Props { navigate: (screen: string) => void }

export function S06_FormFilling({ navigate }: Props) {
  const {
    currentPage, totalPages, detectedFields, status,
    autoAdvance, setAutoAdvance, setStatus,
  } = useFormStore()

  async function handlePause() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_FILL' })
    setStatus('paused')
  }

  async function handleAdvance() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'ADVANCE_PAGE' })
    setStatus('filling')
  }

  async function handleToggleAutoAdvance() {
    const next = !autoAdvance
    setAutoAdvance(next)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'SET_AUTO_ADVANCE', value: next })
    if (next && status === 'page_complete') handleAdvance()
  }

  const pageProgress = totalPages ? (currentPage / totalPages) * 100 : 50
  const totalFilled = detectedFields.filter((f) => f.status === 'filled').length
  const totalFieldCount = detectedFields.length

  // Group fields by page, sorted
  const pageNumbers = [...new Set(detectedFields.map((f) => f.pageIndex))].sort((a, b) => a - b)
  const fieldsByPage = pageNumbers.reduce<Record<number, DetectedField[]>>((acc, p) => {
    acc[p] = detectedFields.filter((f) => f.pageIndex === p)
    return acc
  }, {})

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '16px 24px', gap: 14 }}>

        {/* Auto-advance toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#F9FAFB', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              {autoAdvance ? '⚡ Full auto' : '🔍 Semi-auto'}
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>
              {autoAdvance ? 'Pages advance automatically' : 'You review each page before advancing'}
            </div>
          </div>
          <button
            onClick={handleToggleAutoAdvance}
            style={{
              width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
              background: autoAdvance ? '#534AB7' : '#D1D5DB', position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3,
              left: autoAdvance ? 20 : 3,
              width: 16, height: 16, borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        {/* Progress bar */}
        {totalPages && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
              <span>Page {currentPage} of {totalPages}</span>
              <span>{totalFilled}/{totalFieldCount} fields</span>
            </div>
            <ProgBar value={pageProgress} color="#534AB7" />
          </div>
        )}

        {/* Pages list */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Armed state — waiting for user to click Apply */}
          {status === 'armed' && detectedFields.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9CA3AF', padding: '8px 0' }}>
              <Spinner size={16} color="#534AB7" />
              <span style={{ fontSize: 13 }}>Waiting for you to click Apply…</span>
            </div>
          )}

          {/* Scanning spinner when filling but no fields yet */}
          {status === 'filling' && detectedFields.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9CA3AF', padding: '8px 0' }}>
              <Spinner size={16} color="#534AB7" />
              <span style={{ fontSize: 13 }}>Scanning fields…</span>
            </div>
          )}

          {pageNumbers.map((pageNum) => {
            const fields = fieldsByPage[pageNum]
            const isPrev = pageNum < currentPage
            const isCurrent = pageNum === currentPage
            const filledCount = fields.filter((f) => f.status === 'filled').length

            return (
              <div key={pageNum}>
                {/* Page header */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: isPrev ? 4 : 8,
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: isPrev ? '#9CA3AF' : '#534AB7',
                  }}>
                    Page {pageNum}
                  </span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                    {filledCount}/{fields.length} ✅
                  </span>
                </div>

                {/* Previous page — collapsed summary */}
                {isPrev && (
                  <div style={{
                    padding: '7px 12px', borderRadius: 8,
                    background: '#F9FAFB', border: '1px solid #E5E7EB',
                    fontSize: 12, color: '#6B7280',
                    display: 'flex', flexWrap: 'wrap', gap: '4px 8px',
                  }}>
                    {fields.filter((f) => f.status === 'filled').slice(0, 4).map((f, i, arr) => (
                      <span key={i} style={{ color: '#374151' }}>
                        {f.label}{i < arr.length - 1 ? ' ·' : ''}
                      </span>
                    ))}
                    {filledCount > 4 && (
                      <span>+{filledCount - 4} more</span>
                    )}
                    {filledCount === 0 && <span style={{ fontStyle: 'italic' }}>No fields filled</span>}
                  </div>
                )}

                {/* Current page — full field list */}
                {isCurrent && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {fields.length === 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9CA3AF', padding: '4px 0' }}>
                        <Spinner size={14} color="#534AB7" />
                        <span style={{ fontSize: 13 }}>Detecting fields…</span>
                      </div>
                    )}
                    {fields.map((field, i) => {
                      const filled = field.status === 'filled'
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px', borderRadius: 8,
                            background: filled ? '#F9FAFB' : '#FFFFFF',
                            border: `1px solid ${filled ? (field.isAI ? '#EEEEF9' : '#E7F6F1') : '#E5E7EB'}`,
                            borderLeft: `3px solid ${filled ? (field.isAI ? '#534AB7' : '#1D9E75') : '#D1D5DB'}`,
                            opacity: filled ? 1 : 0.65,
                            transition: 'all 0.2s',
                          }}
                        >
                          <span style={{ fontSize: 14, flexShrink: 0 }}>
                            {filled ? (field.isAI ? '🤖' : '✅') : '⏳'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: '#9CA3AF' }}>{field.label}</div>
                            {filled && field.value && (
                              <div style={{ fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {field.value}
                              </div>
                            )}
                          </div>
                          {filled && field.isAI && (
                            <span style={{ fontSize: 10, background: '#EEEEF9', color: '#534AB7', borderRadius: 4, padding: '2px 5px', fontWeight: 600, flexShrink: 0 }}>
                              AI
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
          {status === 'page_complete' && (
            <Btn kind="primary" fullWidth onClick={handleAdvance}>
              ✓ Looks good — Next Page →
            </Btn>
          )}
          {status === 'filling' && (
            <Btn kind="secondary" fullWidth onClick={handlePause}>Pause</Btn>
          )}
          {status === 'paused' && (
            <Btn kind="primary" fullWidth onClick={() => setStatus('filling')}>Resume</Btn>
          )}
          {status === 'done' && (
            <Btn kind="success" fullWidth onClick={() => navigate('S07')}>Review & Submit →</Btn>
          )}
          <button
            onClick={() => navigate('S03')}
            style={{ background: 'none', border: 'none', color: '#E24B4A', fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            Stop & Start Over
          </button>
        </div>
      </div>
      <BottomNav active="apply" navigate={navigate} />
    </div>
  )
}
