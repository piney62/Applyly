import { indeedAdapter } from './adapters/indeed'
import { workdayAdapter } from './adapters/workday'
import { greenhouseAdapter } from './adapters/greenhouse'
import { leverAdapter } from './adapters/lever'
import type { PlatformAdapter } from './adapters/types'

export interface JobInfo {
  platform: string
  company: string
  jobTitle: string
  jobUrl: string
  jobDescription: string
}

const adapters: PlatformAdapter[] = [indeedAdapter, workdayAdapter, greenhouseAdapter, leverAdapter]

export function detectPlatform(): JobInfo | null {
  const url = window.location.href
  for (const adapter of adapters) {
    if (adapter.detect(url)) {
      const info = adapter.extract()
      // Only report if we got at least a job title or company
      if (info.jobTitle || info.company) {
        return info
      }
    }
  }
  return null
}

// Pick the adapter that owns this URL (used by stateMachine for form-filling overrides)
export function findAdapter(url: string): PlatformAdapter | null {
  return adapters.find((a) => a.detect(url)) ?? null
}
