import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  MOCK_URL,
  NASTY,
  NONCE,
  PAGE_PROPS,
  QUEUE_STUB,
  SITE_ID,
  TRACKER_SRC,
  attribute,
  expectCleanBrowser,
  expectGoodHit,
  hitsFor,
  isEvent,
  isPageview,
  resetHits,
  runTag,
  sleep,
  trackerTags,
  waitForHits,
  waitForTracker,
  watchBrowser,
  withTag
} from './support'

// See CONTRACT.md for what each route of the example app must render.

test.beforeEach(async ({ request }) => {
  await resetHits(request)
})

interface RawPage {
  html: string
  headers: Record<string, string>
  tracker: string
}

// Fetches the page without a browser and checks the tracker tag in the HTML.
async function checkRawTag(request: APIRequestContext, path: string, { props = true } = {}): Promise<RawPage> {
  const response = await request.get(withTag(path, runTag()))
  expect(response.status(), `GET ${path} answers 200`).toBe(200)
  const headers = response.headers()
  expect(headers['content-type'], 'the page is HTML').toMatch(/^text\/html/i)
  const html = await response.text()

  const tags = trackerTags(html)
  expect(tags, 'exactly one tracker script tag').toHaveLength(1)
  const tracker = tags[0]
  expect(html.indexOf(tracker), 'the tracker tag is inside <head>').toBeLessThan(html.search(/<\/head>/i))
  expect(html.indexOf(tracker)).toBeGreaterThan(html.search(/<head[\s>]/i))
  expect(attribute(tracker, 'defer'), 'the tracker tag has defer').not.toBeUndefined()
  expect(attribute(tracker, 'src'), 'src is the script host + /js/pa.js').toBe(TRACKER_SRC)
  expect(attribute(tracker, 'data-site'), 'data-site is the site id').toBe(SITE_ID)
  if (props) expect(attribute(tracker, 'data-props'), 'data-props names the props function').toBe('privatusPageProps')
  return { html, headers, tracker }
}

// Opens the page in the browser, checks the tag in the live DOM and waits for
// the real tracker to load and start.
async function openWithTracker(page: Page, path: string, tag: string): Promise<void> {
  const loaded = page.waitForResponse((response) => response.url() === TRACKER_SRC)
  await page.goto(withTag(path, tag))
  const response = await loaded
  expect(response.status(), 'pa.js loads from the mock collector').toBe(200)

  const dom = await page.evaluate((src) => {
    const all = [...document.querySelectorAll('script')].filter((s) => s.getAttribute('src') === src)
    return {
      inHead: all.filter((s) => s.parentElement === document.head).length,
      total: all.length,
      defer: all.every((s) => s.defer)
    }
  }, TRACKER_SRC)
  expect(dom, 'one deferred tracker tag, in <head>').toEqual({ inHead: 1, total: 1, defer: true })
  await waitForTracker(page)
}

async function expectPageview(request: APIRequestContext, tag: string, props: Record<string, unknown> | null) {
  const [hit] = await waitForHits(request, tag, isPageview, { what: 'a pageview' })
  expectGoodHit(hit)
  if (props) {
    expect(hit.data.props, 'the pageview carries the page props').toEqual(props)
    // toEqual already checks types; say it plainly for the report.
    expect(typeof hit.data.props?.beta, 'beta stays a boolean').toBe('boolean')
    expect(typeof hit.data.props?.seats, 'seats stays a number').toBe('number')
  }
  return hit
}

// Loads the click map module when the tag did not ask for it, so the
// data-privatus-click name is still checked against the real module.
async function ensureClickModule(page: Page): Promise<void> {
  const loaded = await page.evaluate(() => !!document.querySelector('script[src*="/js/pa.clicks.js"]'))
  if (!loaded) await page.addScriptTag({ url: `${MOCK_URL}/js/pa.clicks.js` })
  await page.waitForFunction(() => {
    const pa = (window as unknown as { privatus?: { _clickName?: unknown } }).privatus
    return !!pa && typeof pa._clickName === 'function'
  })
}

test.describe('/ (the tag in head)', () => {
  test('prints the tag, props script and queue stub, with the CSP nonce', async ({ request }) => {
    const { html, headers, tracker } = await checkRawTag(request, '/')
    const trackerAt = html.indexOf(tracker)

    const stubAt = html.indexOf(QUEUE_STUB)
    expect(stubAt, 'the official queue stub is printed').toBeGreaterThan(-1)
    expect(stubAt, 'the queue stub comes before the tracker tag').toBeLessThan(trackerAt)

    const propsAt = html.indexOf('window.privatusPageProps=function(){return ')
    expect(propsAt, 'the page props script is printed').toBeGreaterThan(-1)
    expect(propsAt, 'the page props script comes before the tracker tag').toBeLessThan(trackerAt)

    const csp = headers['content-security-policy']
    if (!csp) {
      test.info().annotations.push({ type: 'note', description: 'No Content-Security-Policy header: nonce not checked.' })
      return
    }
    expect(csp, 'the policy allows the nonce').toContain(`'nonce-${NONCE}'`)
    expect(csp, 'the policy allows the script host').toContain(new URL(MOCK_URL).origin)
    const inline = [...html.matchAll(/<script\b([^>]*)>/gi)]
      .map((m) => m[0])
      .filter((t) => attribute(t, 'src') === undefined)
    expect(inline.length, 'two inline scripts: the stub and the props').toBeGreaterThanOrEqual(2)
    for (const t of inline) expect(attribute(t, 'nonce'), `inline script ${t} has the nonce`).toBe(NONCE)
  })

  test('pa.js loads, window.privatus exists and nothing is blocked', async ({ page }) => {
    const log = await watchBrowser(page)
    await openWithTracker(page, '/', runTag())
    const props = await page.evaluate(() => {
      const fn = (window as unknown as { privatusPageProps?: () => unknown }).privatusPageProps
      return typeof fn === 'function' ? fn() : null
    })
    expect(props, 'window.privatusPageProps() returns the props').toEqual(PAGE_PROPS)
    await sleep(500)
    await expectCleanBrowser(page, log)
  })

  test('a pageview with the site id and typed page props reaches the collector', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/', tag)
    const hit = await expectPageview(request, tag, PAGE_PROPS)
    expect(new URL(hit.data.url as string).pathname).toBe('/')
    await expectCleanBrowser(page, log)
  })

  test('the queue stub keeps a privatus.track call made before pa.js loads', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route(TRACKER_SRC, async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(withTag('/', tag), { waitUntil: 'commit' })
    await page.waitForFunction(() => {
      const pa = (window as unknown as { privatus?: { q?: unknown } }).privatus
      return !!pa && Array.isArray(pa.q)
    })
    await page.evaluate(() => {
      ;(window as unknown as { privatus: { track: (n: string, p: object) => void } }).privatus.track(
        'Queued before load',
        { via: 'stub' }
      )
    })
    release()
    await waitForTracker(page)
    const [hit] = await waitForHits(request, tag, isEvent('Queued before load'), { what: 'the queued event' })
    expectGoodHit(hit)
    expect(hit.data.props).toEqual({ ...PAGE_PROPS, via: 'stub' })
    await expectCleanBrowser(page, log)
  })
})

test.describe('/event (event and click helpers)', () => {
  test('renders the tag and the helper attributes', async ({ request, page }) => {
    await checkRawTag(request, '/event')
    const log = await watchBrowser(page)
    await openWithTracker(page, '/event', runTag())

    const button = page.locator('[data-privatus-event="Report exported"]')
    await expect(button).toHaveCount(1)
    await expect(button).toHaveAttribute('data-privatus-prop-format', 'csv')
    await expect(button).toHaveAttribute('data-privatus-prop-source', 'toolbar')
    await expect(page.locator('a[data-privatus-click="pricing.cta"]')).toHaveCount(1)
    const form = page.locator('form[data-privatus-event="Signup form"]')
    await expect(form).toHaveCount(1)
    await expect(form.locator('[type="submit"]')).toHaveCount(1)
    await expectCleanBrowser(page, log)
  })

  test('a pageview with the page props reaches the collector', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/event', tag)
    await expectPageview(request, tag, PAGE_PROPS)
    await expectCleanBrowser(page, log)
  })

  test('clicking the button sends exactly one "Report exported" event', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/event', tag)
    await page.locator('[data-privatus-event="Report exported"]').click()
    await waitForHits(request, tag, isEvent('Report exported'), { what: 'the "Report exported" event' })
    await sleep(1500)
    const hits = (await hitsFor(request, tag)).filter(isEvent('Report exported'))
    expect(hits, 'exactly one event hit').toHaveLength(1)
    expectGoodHit(hits[0])
    expect(hits[0].data.props).toMatchObject({ format: 'csv', source: 'toolbar' })
    await expectCleanBrowser(page, log)
  })

  test('submitting the form sends "Signup form"', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/event', tag)
    await page.locator('form[data-privatus-event="Signup form"] [type="submit"]').click()
    const hits = await waitForHits(request, tag, isEvent('Signup form'), { what: 'the "Signup form" event' })
    await sleep(1000)
    expect((await hitsFor(request, tag)).filter(isEvent('Signup form')), 'exactly one form event').toHaveLength(1)
    expectGoodHit(hits[0])
    await page.waitForLoadState()
    await expectCleanBrowser(page, log)
  })

  test('the click map module reports the data-privatus-click name', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/event', tag)
    await ensureClickModule(page)
    await page.locator('a[data-privatus-click="pricing.cta"]').click()
    const [hit] = await waitForHits(
      request,
      tag,
      (h) => h.data.type === 'click' && h.data.selector === '[data-privatus-click="pricing.cta"]',
      { what: 'a click hit named pricing.cta' }
    )
    expectGoodHit(hit)
    await expectCleanBrowser(page, log)
  })
})

test.describe('/nasty (escaping)', () => {
  test('the nasty value never runs and survives the round trip', async ({ page, request }) => {
    const { html } = await checkRawTag(request, '/nasty')
    expect(html, 'the raw script break-out is not in the HTML').not.toContain('<script>window.__pwned=1</script>')

    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/nasty', tag)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned), 'window.__pwned').toBeUndefined()

    const fromFunction = await page.evaluate(
      () => (window as unknown as { privatusPageProps: () => Record<string, unknown> }).privatusPageProps().nasty
    )
    expect(fromFunction, 'privatusPageProps().nasty is the original string').toBe(NASTY)

    const [pageview] = await waitForHits(request, tag, isPageview, { what: 'a pageview' })
    expectGoodHit(pageview)
    expect(pageview.data.props?.nasty, 'the pageview props carry the original string').toBe(NASTY)

    const button = page.locator('[data-privatus-prop-nasty]')
    await expect(button).toHaveCount(1)
    expect(await button.getAttribute('data-privatus-prop-nasty'), 'the DOM attribute is the original string').toBe(NASTY)

    await button.click()
    const [event] = await waitForHits(request, tag, (h) => h.data.type === 'event', { what: 'the nasty event' })
    expectGoodHit(event)
    expect(event.data.props?.nasty, 'the event props carry the original string').toBe(NASTY)

    expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined()
    await expectCleanBrowser(page, log)
  })
})

test.describe('/auto (auto inject)', () => {
  test('the middleware adds the tag exactly once', async ({ page, request }) => {
    const probe = await request.get(withTag('/auto', runTag()))
    test.skip(probe.status() === 404, 'This package has no auto inject (GET /auto is 404).')

    const { html, headers } = await checkRawTag(request, '/auto', { props: false })
    expect(html.split('/js/pa.js').length - 1, 'pa.js is named once').toBe(1)
    // A server that compresses its pages sends the compressed size, which is
    // correct HTTP, while `html` here is already decompressed. So the length
    // is only comparable for an uncompressed page.
    const encoding = (headers['content-encoding'] ?? 'identity').toLowerCase()
    if (headers['content-length'] && encoding === 'identity') {
      expect(Number(headers['content-length']), 'Content-Length matches the new body').toBe(
        Buffer.byteLength(html, 'utf8')
      )
    }

    const log = await watchBrowser(page)
    const tag = runTag()
    await openWithTracker(page, '/auto', tag)
    await expectPageview(request, tag, null)
    await expectCleanBrowser(page, log)
  })
})

// The HTML between the two marker meta tags on /off and /off-plain.
function betweenMarkers(html: string): string {
  const between = html.match(/<meta name="privatus-off-start"[^>]*>([\s\S]*?)<meta name="privatus-off-end"/i)
  expect(between, 'the page has the two marker meta tags (CONTRACT.md)').not.toBeNull()
  return between![1].trim()
}

test.describe('/off (forced off, queue stub on)', () => {
  test('prints only the queue stub', async ({ request }) => {
    const response = await request.get(withTag('/off', runTag()))
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(trackerTags(html), 'no tracker tag').toEqual([])
    expect(html, 'no tracker script').not.toContain('/js/pa.js')
    expect(html, 'no page props script').not.toContain('privatusPageProps')

    const printed = betweenMarkers(html)
    const scripts = [...printed.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    expect(scripts, 'the helper printed one script: the queue stub').toHaveLength(1)
    expect(printed, 'nothing but the queue stub between the markers').toBe(scripts[0][0])
    expect(scripts[0][2], 'the script is the official queue stub').toBe(QUEUE_STUB)
    expect(attribute(scripts[0][0], 'src'), 'the stub is inline').toBeUndefined()
    if (response.headers()['content-security-policy']) {
      expect(attribute(scripts[0][0], 'nonce'), 'the stub has the nonce').toBe(NONCE)
    }
  })

  test('privatus.track queues and does not throw, and nothing is sent', async ({ page, request }) => {
    const log = await watchBrowser(page)
    const tag = runTag()
    await page.goto(withTag('/off', tag))
    const result = await page.evaluate(() => {
      const pa = (window as unknown as { privatus?: { q?: unknown[]; track?: (n: string) => void } }).privatus
      if (!pa || !Array.isArray(pa.q)) return { stub: false, threw: null, queued: null }
      const before = pa.q.length
      let threw: string | null = null
      try {
        pa.track!('x')
      } catch (error) {
        threw = String(error)
      }
      return { stub: true, threw, queued: pa.q.slice(before) }
    })
    expect(result.stub, 'window.privatus exists with a q array').toBe(true)
    expect(result.threw, 'privatus.track does not throw').toBeNull()
    expect(result.queued, 'the call goes onto the queue').toEqual([['track', ['x']]])
    expect(
      await page.evaluate(() => document.querySelectorAll('script[src*="/js/pa.js"]').length),
      'no tracker in the page'
    ).toBe(0)
    await sleep(1500)
    expect(await hitsFor(request, tag), 'no hits').toEqual([])
    await expectCleanBrowser(page, log)
  })
})

test.describe('/off-plain (forced off, no queue stub)', () => {
  test('prints nothing and sends nothing', async ({ page, request }) => {
    const response = await request.get(withTag('/off-plain', runTag()))
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html, 'no tracker tag').not.toContain('/js/pa.js')
    expect(html, 'no page props script').not.toContain('privatusPageProps')
    expect(html, 'no queue stub').not.toContain(QUEUE_STUB)
    expect(betweenMarkers(html), 'the helper printed nothing between the markers').toBe('')

    const log = await watchBrowser(page)
    const tag = runTag()
    await page.goto(withTag('/off-plain', tag))
    expect(await page.evaluate(() => typeof (window as unknown as { privatus?: unknown }).privatus)).toBe('undefined')
    await sleep(1500)
    expect(await hitsFor(request, tag), 'no hits').toEqual([])
    await expectCleanBrowser(page, log)
  })
})
