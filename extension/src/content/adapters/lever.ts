import type { JobInfo } from '../detector'

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
    document.querySelector('.posting-requirements')

  if (specific) return specific.textContent?.trim() ?? ''

  // Fallback: collect all .section blocks (skip header/apply sections)
  const sections = Array.from(document.querySelectorAll('.section'))
  const text = sections
    .map((s) => s.textContent?.trim() ?? '')
    .filter((t) => t.length > 50)
    .join('\n\n')

  return text || document.querySelector('.content')?.textContent?.trim() || ''
}

export const leverAdapter = {
  detect: (url: string) => url.includes('jobs.lever.co'),
  extract: (): JobInfo => ({
    platform: 'Lever',
    company: window.location.pathname.split('/')[1] ?? '',
    jobTitle: leverTitle(),
    jobUrl: window.location.href,
    jobDescription: leverDescription(),
  }),
}
