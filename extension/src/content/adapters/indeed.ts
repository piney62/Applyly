import type { JobInfo } from '../detector'

// innerText skips <style>/<script> content; textContent does not
function text(el: Element | null): string {
  if (!el) return ''
  return (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || ''
}

function indeedTitle(): string {
  // Right panel selectors first (search results page)
  return (
    text(document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]')) ||
    text(document.querySelector('.jobsearch-JobInfoHeader-title')) ||
    text(document.querySelector('[class*="JobInfoHeader"] h2')) ||
    text(document.querySelector('[class*="JobInfoHeader"] h1')) ||
    // Dedicated viewjob page fallback
    text(document.querySelector('h1.jobsearch-JobInfoHeader-title')) ||
    text(document.querySelector('.jobsearch-RightPane h1')) ||
    ''
  )
}

function indeedCompany(): string {
  return (
    text(document.querySelector('[data-testid="inlineHeader-companyName"] a')) ||
    text(document.querySelector('[data-testid="inlineHeader-companyName"]')) ||
    text(document.querySelector('[data-company-name]')) ||
    text(document.querySelector('a[data-tn-element="companyName"]')) ||
    text(document.querySelector('[class*="companyName"] a')) ||
    text(document.querySelector('[class*="companyName"]')) ||
    ''
  )
}

function indeedDescription(): string {
  return (
    text(document.querySelector('#jobDescriptionText')) ||
    text(document.querySelector('[data-testid="jobsearch-JobComponent-description"]')) ||
    text(document.querySelector('[class*="jobDescriptionText"]')) ||
    text(document.querySelector('[id*="jobDescription"]')) ||
    text(document.querySelector('.jobsearch-RightPane [class*="description"]')) ||
    ''
  )
}

export const indeedAdapter = {
  detect: (url: string) =>
    url.includes('indeed.com/viewjob') ||
    url.includes('indeed.com/jobs') ||
    (url.includes('indeed.com') && url.includes('vjk=')),
  extract: (): JobInfo => ({
    platform: 'Indeed',
    company: indeedCompany(),
    jobTitle: indeedTitle(),
    jobUrl: window.location.href,
    jobDescription: indeedDescription(),
  }),
}
