import type { JobInfo } from '../detector'
import type { PlatformAdapter } from './types'

function ghText(sel: string): string {
  return (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim()
    || document.querySelector(sel)?.textContent?.trim()
    || ''
}

function ghCompany(): string {
  return (
    ghText('.company-name a') ||
    ghText('.company-name') ||
    ghText('[class*="company"]') ||
    // Fallback: extract slug from URL (e.g. boards.greenhouse.io/anthropic/jobs/...)
    window.location.pathname.split('/').filter(Boolean)[0] ||
    ''
  )
}

function ghTitle(): string {
  return (
    ghText('h1.app-title') ||
    ghText('.app-title') ||
    ghText('h1') ||
    ''
  )
}

function ghDescription(): string {
  return (
    ghText('#content') ||
    ghText('.job-description') ||
    ghText('[class*="description"]') ||
    ''
  )
}

export const greenhouseAdapter: PlatformAdapter = {
  name: 'Greenhouse',
  // boards.greenhouse.io/{company}/jobs/{id}  — standard pattern
  // company.greenhouse.io/jobs/{id}           — legacy pattern
  detect: (url: string) =>
    url.includes('boards.greenhouse.io') ||
    (url.includes('greenhouse.io') && url.includes('/jobs')),
  extract: (): JobInfo => ({
    platform: 'Greenhouse',
    company: ghCompany(),
    jobTitle: ghTitle(),
    jobUrl: window.location.href,
    jobDescription: ghDescription(),
  }),
  selectors: {
    // Greenhouse boards: single-page application form — Submit is the only action button.
    // isLastPage() returns true immediately (button text contains "submit"), so the machine
    // fills all fields then calls complete() without clicking Submit.
    nextButton: [
      '#application_form input[type="submit"]',
      '#application_form button[type="submit"]',
      '[data-submits] input[type="submit"]',
      '[data-submits] button[type="submit"]',
    ],
    submitButton: [
      '#application_form input[type="submit"]',
      '#application_form button[type="submit"]',
    ],
    // Resume file input — referenced if a future pass handles file uploads
    fileInput: 'input#resume, input[type="file"][name="resume"], #application_form input[type="file"]',
    confirmationText: [
      'application submitted',
      'thank you for applying',
      'thanks for your interest',
      'application has been received',
      'we have received your application',
    ],
  },
}
