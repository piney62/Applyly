import type { JobInfo } from '../detector'
import type { PlatformAdapter } from './types'

export const greenhouseAdapter: PlatformAdapter = {
  name: 'Greenhouse',
  detect: (url: string) => url.includes('greenhouse.io/jobs'),
  extract: (): JobInfo => ({
    platform: 'Greenhouse',
    company: document.querySelector('.company-name')?.textContent?.trim() ?? '',
    jobTitle: document.querySelector('.app-title')?.textContent?.trim() ?? '',
    jobUrl: window.location.href,
    jobDescription: document.querySelector('#content')?.textContent?.trim() ?? '',
  }),
  selectors: {
    // Greenhouse classic + boards use a single-page application form with one Submit button.
    nextButton: [
      '[data-submits] input[type="submit"]',
      '[data-submits] button[type="submit"]',
      '#application_form input[type="submit"]',
      '#application_form button[type="submit"]',
    ],
    submitButton: [
      '[data-submits] input[type="submit"]',
      '[data-submits] button[type="submit"]',
    ],
    confirmationText: [
      'application submitted',
      'thank you for applying',
      'thanks for your interest',
    ],
  },
}
