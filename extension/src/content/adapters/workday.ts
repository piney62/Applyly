import type { JobInfo } from '../detector'
import type { PlatformAdapter } from './types'

export const workdayAdapter: PlatformAdapter = {
  name: 'Workday',
  detect: (url: string) => url.includes('myworkdayjobs.com'),
  extract: (): JobInfo => ({
    platform: 'Workday',
    company:
      document
        .querySelector('[data-automation-id="jobPostingHeader"]')
        ?.textContent?.trim() ?? '',
    jobTitle:
      document
        .querySelector('[data-automation-id="jobPostingHeader"] h2')
        ?.textContent?.trim() ?? '',
    jobUrl: window.location.href,
    jobDescription:
      document
        .querySelector('[data-automation-id="jobPostingDescription"]')
        ?.textContent?.trim() ?? '',
  }),
  selectors: {},
}
