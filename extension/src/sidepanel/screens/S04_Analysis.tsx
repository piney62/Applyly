import { Pill } from '../components/Pill'
import { ProgBar } from '../components/ProgBar'
import { Btn } from '../components/Btn'
import { BottomNav } from '../components/BottomNav'
import { useJobStore, Keyword } from '../store/jobStore'

interface Props { navigate: (screen: string) => void }

function scoreLabel(score: number): string {
  if (score >= 75) return 'Strong match'
  if (score >= 50) return 'Good match'
  return 'Weak match'
}

function scoreColor(score: number): string {
  if (score >= 75) return '#1D9E75'
  if (score >= 50) return '#EF9F27'
  return '#E24B4A'
}

function keywordColor(status: Keyword['status']): 'green' | 'amber' | 'red' {
  if (status === 'matched') return 'green'
  if (status === 'weak') return 'amber'
  return 'red'
}

export function S04_Analysis({ navigate }: Props) {
  const analysisResult = useJobStore((s) => s.analysisResult)

  if (!analysisResult) {
    navigate('S03')
    return null
  }

  const { matchScore, keywords, knockouts } = analysisResult
  const color = scoreColor(matchScore)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Match Score */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 52, fontWeight: 700, color, lineHeight: 1 }}>{matchScore}%</div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#6B7280' }}>{scoreLabel(matchScore)}</div>
        </div>

        <ProgBar value={matchScore} />

        {/* Knockout Requirements */}
        {knockouts.length > 0 && (
          <div style={{ background: '#FDEAEA', border: '1px solid #E24B4A', borderRadius: 8, padding: '10px 12px' }}>
            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#E24B4A' }}>
              ⛔ Knockout Requirements
            </p>
            {knockouts.map((k, i) => (
              <p key={i} style={{ margin: '2px 0', fontSize: 12, color: '#374151' }}>
                ❌ {k.keyword} — verify eligibility separately
              </p>
            ))}
          </div>
        )}

        {/* Keywords */}
        <div>
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            JD Keywords
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {keywords.map((kw, i) => (
              <Pill key={i} color={keywordColor(kw.status)}>{kw.word}</Pill>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
          <Btn kind="primary" fullWidth onClick={() => navigate('S05')}>
            Fill Form + Generate Cover Letter
          </Btn>
          <button
            onClick={() => navigate('S03')}
            style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            ← Back
          </button>
        </div>
      </div>
      <BottomNav active="apply" navigate={navigate} />
    </div>
  )
}
