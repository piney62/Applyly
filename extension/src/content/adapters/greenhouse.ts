import type { JobInfo } from '../detector'

export const greenhouseAdapter = {
  detect: (url: string) => url.includes('greenhouse.io/jobs'),
  extract: (): JobInfo => ({
    platform: 'Greenhouse',
    company: document.querySelector('.company-name')?.textContent?.trim() ?? '',
    jobTitle: document.querySelector('.app-title')?.textContent?.trim() ?? '',
    jobUrl: window.location.href,
    jobDescription: document.querySelector('#content')?.textContent?.trim() ?? '',
  }),
}
