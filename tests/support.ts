import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const BASE_URL = (process.env.BASE_URL || 'http://example-app:8080').replace(/\/$/, '')
export const MOCK_URL = (process.env.MOCK_URL || 'http://mock:4000').replace(/\/$/, '')
export const SITE_ID = process.env.PRIVATUS_SITE_ID || 'pa_CONFORMANCE1'
export const TRACKER_SRC = `${MOCK_URL}/js/pa.js`
export const NONCE = 'testnonce'

// What every example app passes as page props on /, /event and /nasty.
export const PAGE_PROPS = { plan: 'pro', role: 'admin', beta: true, seats: 3 }

// A value that breaks out of a <script> or an attribute when it is not escaped
// properly. U+2028 and U+2029 end a line in older JavaScript parsers.
export const NASTY = '</script><script>window.__pwned=1</script>\u2028\u2029&<>"\''

export const QUEUE_STUB =
  "window.privatus=window.privatus||{q:[]};['track','pageview','props','optOut','optIn','ready']" +
  '.forEach(function(m){window.privatus[m]=window.privatus[m]||function(){window.privatus.q.push(' +
  '[m,Array.prototype.slice.call(arguments)])}})'

export interface Hit {
  seq: number
  at: string
  contentType: string | null
  raw: Record<string, unknown>
  data: {
    site?: string
    type?: string
    url?: string
    name?: string
    props?: Record<string, unknown>
    selector?: string
    automation?: string
    [key: string]: unknown
  }
  problems: string[]
}

export interface BrowserLog {
  errors: string[]
  violations: string[]
}

// Every test visits its page with its own utm_content value. The tracker keeps
// utm_ parameters in the URL it sends, so a test only looks at its own hits,
// even when a hit from the previous page arrives late.
let counter = 0
export function runTag(): string {
  counter += 1
  return `conf${Date.now().toString(36)}${counter}`
}

export function withTag(path: string, tag: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}utm_content=${tag}`
}

export async function resetHits(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${MOCK_URL}/__reset`)
  expect(response.ok(), 'the mock collector forgets its hits').toBeTruthy()
}

export async function hitsFor(request: APIRequestContext, tag: string): Promise<Hit[]> {
  const response = await request.get(`${MOCK_URL}/__hits`)
  const hits = (await response.json()) as Hit[]
  return hits.filter((hit) => typeof hit.data.url === 'string' && hit.data.url.includes(`utm_content=${tag}`))
}

// Waits until at least `count` of this test's hits match, then returns them.
export async function waitForHits(
  request: APIRequestContext,
  tag: string,
  match: (hit: Hit) => boolean,
  { count = 1, timeout = 10_000, what = 'hit' } = {}
): Promise<Hit[]> {
  let found: Hit[] = []
  await expect
    .poll(
      async () => {
        found = (await hitsFor(request, tag)).filter(match)
        return found.length
      },
      { message: `the mock collector gets ${what}`, timeout }
    )
    .toBeGreaterThanOrEqual(count)
  return found
}

export const isPageview = (hit: Hit) => hit.data.type === 'pageview'
export const isEvent = (name: string) => (hit: Hit) => hit.data.type === 'event' && hit.data.name === name

// Checks a hit the way the real collector would keep it: well formed, the
// right site, and not marked as coming from an automated browser.
export function expectGoodHit(hit: Hit): void {
  expect(hit.problems, 'the hit is well formed').toEqual([])
  expect(hit.data.site, 'the hit carries the site id').toBe(SITE_ID)
  expect(hit.data.automation, 'the hit is not marked as a bot').toBeUndefined()
  expect(hit.contentType, 'the tracker sends text/plain').toMatch(/^text\/plain/)
}

// Must run before the first page.goto.
//
// - Hides navigator.webdriver. The tracker sends nothing from an automated
//   browser, so without this no hit would ever arrive. The launch flag in
//   playwright.config.ts already does it; this makes sure.
// - Records Content Security Policy violations and console errors.
export async function watchBrowser(page: Page): Promise<BrowserLog> {
  const log: BrowserLog = { errors: [], violations: [] }
  await page.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true })
    } catch {
      // Already hidden.
    }
    const w = window as unknown as { __cspViolations: string[] }
    w.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'} (${event.sourceFile}:${event.lineNumber})`)
    })
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // A missing favicon is the example app's business, not the package's.
    if (/\/favicon\.ico/.test(message.location().url || '')) return
    log.errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => log.errors.push(`page error: ${error.message}`))
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || ''
    // A navigation started by a form submit cancels the page's last requests.
    if (/ERR_ABORTED/.test(failure)) return
    log.errors.push(`request failed: ${request.url()} ${failure}`)
  })
  return log
}

export async function expectCleanBrowser(page: Page, log: BrowserLog): Promise<void> {
  const violations = await page
    .evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations || [])
    .catch(() => [] as string[])
  expect([...log.violations, ...violations], 'no Content Security Policy violations').toEqual([])
  expect(log.errors, 'no console errors, page errors or failed requests').toEqual([])
}

// The real tracker has replaced the queue stub (the stub has a q list, the
// tracker does not).
export async function waitForTracker(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const pa = (window as unknown as { privatus?: { track?: unknown; q?: unknown; _send?: unknown } }).privatus
      return !!pa && typeof pa.track === 'function' && typeof pa._send === 'function' && !('q' in pa)
    },
    undefined,
    { timeout: 10_000 }
  )
}

// All tracker script tags in the raw HTML.
export function trackerTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => tag.includes('/js/pa.js'))
}

// The value of one attribute of a tag, with HTML entities decoded, or
// undefined when the attribute is missing. null for a bare attribute.
export function attribute(tag: string, name: string): string | null | undefined {
  const re = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s>/])`, 'i')
  const match = tag.match(re)
  if (!match) return undefined
  const value = match[1] ?? match[2] ?? match[3]
  if (value === undefined) return null
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
