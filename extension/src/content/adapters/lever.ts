import type { JobInfo } from '../detector'
import type { PlatformAdapter } from './types'

function leverTitle(): string {
  return (
    document.querySelector('[data-qa="posting-name"]')?.textContent?.trim() ||
    document.querySelector('.posting-headline h2')?.textContent?.trim() ||
    document.querySelector('h2.posting-name')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    ''
  )
}

function leverDescription(): string {
  // Try specific description containers first
  const specific =
    document.querySelector('[data-qa="job-description"]') ||
    document.querySelector('.posting-description') ||
    document.querySelector('.posting-requirements') ||
    document.querySelector('.content-wrapper')

  if (specific) return specific.textContent?.trim() ?? ''

  // Fallback: collect all .section blocks (skip header/apply sections)
  const sections = Array.from(document.querySelectorAll('.section, [class*="section"]'))
  const text = sections
    .map((s) => s.textContent?.trim() ?? '')
    .filter((t) => t.length > 50)
    .join('\n\n')

  return text || document.querySelector('.content')?.textContent?.trim() || ''
}

export const leverAdapter: PlatformAdapter = {
  name: 'Lever',
  detect: (url: string) => url.includes('jobs.lever.co'),
  extract: (): JobInfo => ({
    platform: 'Lever',
    company: window.location.pathname.split('/')[1] ?? '',
    jobTitle: leverTitle(),
    jobUrl: window.location.href,
    jobDescription: leverDescription(),
  }),
  selectors: {
    // Lever apply forms are typically single-page; primary action is "Submit application".
    // We still list possible Continue/Submit selectors so findNextButton() can locate them
    // and isLastPage() can recognize the submit (text contains "submit" or "apply").
    nextButton: [
      'button[type="submit"][data-qa="btn-submit"]',
      'button[data-qa="btn-submit"]',
      'form#application-form button[type="submit"]',
    ],
    submitButton: [
      'button[type="submit"][data-qa="btn-submit"]',
      'button[data-qa="btn-submit"]',
    ],
    confirmationText: [
      'thank you for applying',
      'application received',
      'we received your application',
    ],
  },
}
