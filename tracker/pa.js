/*! Privatus Analytics tracker · MIT · https://privatusanalytics.com/open-source
 * No cookies, no storage, no fingerprinting. Sends one small request per hit,
 * and retries it a few times if the server answers with an error.
 */
(function () {
  'use strict'
  var w = window, d = document, loc = location, nav = navigator
  var script = d.currentScript
  if (!script || !w.fetch) return

  function attr(name) { return script.getAttribute('data-' + name) }
  function list(name) {
    return (attr(name) || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)
  }

  var site = attr('site')
  var ns = attr('namespace') || 'privatus'
  var origin = attr('api') || '__PA_TRACKER_ORIGIN__'
  var endpoint = origin + '/api/event'
  var debug = attr('debug') === 'true'
  var spaMode = attr('spa') || 'auto'
  var manual = attr('manual') === 'true'
  var modules = attr('modules') === null ? ['engage'] : list('modules')
  var domains = list('domains')
  var exclude = list('exclude')
  var keepParams = list('params')
  var masks = list('mask').map(function (m) { return m.split('->') })
  var useCanonical = attr('canonical') === 'true'
  var hashMode = attr('hash') === 'true' || spaMode === 'hash'
  // A honeypot page: a hidden link leads here, so only bots arrive. Its hits
  // are sent even from an automated browser, and say which kind it was.
  var honeypot = attr('hp') === 'true'
  // data-hp="false" is the opposite: a page only people reach (behind a
  // login), for comparison. The hit only says which of the two it is.
  var sampled = honeypot || attr('hp') === 'false'
  // data-hp="ch": a "confirm you're human" page shown to a random few
  // visitors. People and bots both see it, so whether a visitor was a bot
  // is not known yet. Sent even from an automated browser, like a honeypot.
  var challenge = attr('hp') === 'ch'
  var propsFn = attr('props')
  var globalProps = {}
  var lastPath = null
  var previousUrl = null
  var currentUrl = loc.href
  var spaNavigation = false

  // Experiments. A redirect to a variant page carries two things in the
  // address, because nothing is ever stored in the browser:
  // - pa_ref: where the visitor really came from, so the visit keeps its
  //   source. Read once here and taken out of the address bar.
  // - pa_preview: a preview link. The server shows the variant it names
  //   and counts nothing.
  var query = new URLSearchParams(loc.search)
  var preview = query.get('pa_preview')
  var carried = query.has('pa_ref') ? query.get('pa_ref') : null
  if (carried !== null && w.history && history.replaceState) {
    query.delete('pa_ref')
    var rest = query.toString()
    history.replaceState(history.state, '', loc.pathname + (rest ? '?' + rest : '') + loc.hash)
  }

  // The click overlay (pa.overlay.js): a member opened this page from
  // their click map, with a pass after the # (#privatus-overlay=...). The
  // pass is taken out of the address at once and handed to the overlay
  // alone. Nothing is sent while the overlay is open, so the member's own
  // look at the page is not counted.
  var overlayPass = null
  var overlayOpen = false
  var overlayMatch = /^#privatus-overlay=([\w=-]+)$/.exec(loc.hash)
  if (overlayMatch && w.history && history.replaceState) {
    overlayPass = overlayMatch[1]
    overlayOpen = true
    history.replaceState(history.state, '', loc.pathname + loc.search)
  }

  function samePage(path) {
    var strip = function (p) { return p.length > 1 ? p.replace(/\/$/, '') : p }
    return strip(path) === strip(loc.pathname)
  }

  // The server answers a pageview of a tested page with the variant this
  // visitor gets: x, a path of the same site. Only a path is followed.
  function variant(answer) {
    var path = answer && answer.x
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' || samePage(path)) return
    var q = new URLSearchParams(loc.search)
    q.delete('pa_preview')
    if (answer.p) q.set('pa_preview', '1')
    else if (!q.has('pa_ref')) q.set('pa_ref', carried !== null ? carried : d.referrer || '')
    var search = q.toString()
    loc.replace(path + (search ? '?' + search : '') + loc.hash)
  }

  function merge() {
    var out = {}
    for (var i = 0; i < arguments.length; i++) {
      var src = arguments[i] || {}
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]
    }
    return out
  }

  function optedOut() {
    try { return w.localStorage.getItem('privatus_optout') === '1' } catch (e) { return false }
  }

  function glob(pattern, value) {
    var re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp('^' + re + '$').test(value)
  }

  function skipReason() {
    if (!site) return 'missing data-site'
    if (overlayOpen) return 'click overlay open'
    if (optedOut()) return 'opted out'
    var local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)|\.local$/.test(loc.hostname) || loc.protocol === 'file:'
    if (local && !debug && attr('allow-local') !== 'true') return 'localhost'
    if (domains.length && domains.indexOf(loc.hostname) < 0) return 'domain not in data-domains'
    if (!honeypot && !challenge && automation()) return 'automated browser'
    return null
  }

  function automation() {
    return nav.webdriver ? 'webdriver' : w._phantom ? 'phantom' : w.__nightmare ? 'nightmare' : w.Cypress ? 'cypress' : ''
  }

  function pageUrl() {
    var href = loc.href
    if (useCanonical) {
      var link = d.querySelector('link[rel="canonical"][href]')
      if (link) href = link.href
    }
    var url = new URL(href, loc.href)
    for (var i = 0; i < exclude.length; i++) if (glob(exclude[i], url.pathname)) return null
    for (var j = 0; j < masks.length; j++) {
      if (masks[j].length === 2 && glob(masks[j][0].trim(), url.pathname)) { url.pathname = masks[j][1].trim(); break }
    }
    var kept = new URLSearchParams()
    url.searchParams.forEach(function (v, k) {
      if (/^(utm_|ref$|via$|source$|gclid|gbraid|wbraid|msclkid|fbclid|ttclid|li_fat_id|twclid|dclid)/.test(k) || keepParams.indexOf(k) >= 0) kept.append(k, v)
    })
    url.search = kept.toString()
    if (!keepsHash(url.hash)) url.hash = ''
    return url.href
  }

  function post(json) {
    return w.fetch(endpoint, { method: 'POST', body: json, keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' } })
  }

  // Hits the server answered with a 4xx or 5xx wait here, oldest first, and
  // are retried one at a time. Memory only: the queue dies with the page.
  var RETRY_DELAYS = [1000, 10000, 60000, 60000, 60000]
  // retrying is true from the moment a retry is scheduled until it settles.
  var retryQueue = [], retrying = false

  function failed(response) { return response.status >= 400 }

  function scheduleRetry() {
    if (retrying || !retryQueue.length) return
    retrying = true
    setTimeout(retry, RETRY_DELAYS[retryQueue[0].n])
  }

  function retry() {
    if (optedOut()) retryQueue = []
    var hit = retryQueue[0]
    if (!hit) { retrying = false; return }
    post(hit.b).then(function (response) {
      var ok = !failed(response)
      // Delivered, or out of retries.
      if (ok || ++hit.n >= RETRY_DELAYS.length) retryQueue.shift()
      if (ok) return retry()
      retrying = false
      scheduleRetry()
    }, function () { retryQueue.shift(); retrying = false; scheduleRetry() })
  }

  function send(type, extra, callback) {
    var done = function () { if (callback) callback() }
    var reason = skipReason()
    if (reason) { if (debug) console.info('[privatus] not sent: ' + reason); return done() }
    var url = extra.u || pageUrl()
    delete extra.u
    if (!url) return done()
    var body = { s: site, t: type, u: url, l: nav.language, w: w.screen && w.screen.width, i: interacted }
    var referrer = spaNavigation ? previousUrl : carried !== null ? carried : d.referrer
    if (referrer) body.r = referrer
    if (keepsHash(new URL(url, loc.href).hash)) body.h = 1
    if (nav.doNotTrack === '1') body.d = 1
    if (nav.globalPrivacyControl) body.g = 1
    if (honeypot) { body.hp = 1; if (automation()) body.a = automation() }
    else if (sampled) body.hp = 0
    else if (challenge) { body.ch = 1; if (automation()) body.a = automation() }
    if (zone) body.tz = zone
    if (preview && type === 'pageview') body.xp = preview
    var extraProps = propsFn && typeof w[propsFn] === 'function' ? w[propsFn]() : null
    if (extra.p || extraProps) extra.p = merge(extraProps, extra.p)
    for (var k in extra) body[k] = extra[k]
    if (debug) { console.info('[privatus]', type, body); return done() }
    var json = JSON.stringify(body)
    try {
      post(json).then(function (response) {
        if (failed(response) && retryQueue.length < 20) { retryQueue.push({ b: json, n: 0 }); scheduleRetry() }
        // 200 with a body only when an experiment sends the visitor on.
        if (type === 'pageview' && !spaNavigation && response.status === 200) response.json().then(variant, function () {})
        done()
      }, done)
    } catch (e) {
      if (nav.sendBeacon) nav.sendBeacon(endpoint, json)
      done()
    }
  }

  // Engagement: visible time and max scroll for the current page.
  var engage = modules.indexOf('engage') >= 0
  var visibleSince = null, engagedMs = 0, maxScroll = 0
  var engagedUrl = null

  function resetEngagement() {
    engagedMs = 0
    maxScroll = 0
    visibleSince = d.visibilityState === 'visible' ? Date.now() : null
  }

  function scrollDepth() {
    var el = d.documentElement, body = d.body || {}
    var top = el.scrollTop || body.scrollTop || 0
    var height = Math.max(el.scrollHeight, body.scrollHeight || 0) - el.clientHeight
    return height > 0 ? Math.min(100, Math.round((top / height) * 100)) : 100
  }

  // force is true only for the first input: pagehide passes its event here.
  function flushEngagement(force) {
    if (!engage || lastPath === null) return
    var ms = engagedMs + (visibleSince ? Date.now() - visibleSince : 0)
    if (ms < 1000 && force !== true) return
    // Credit the page the time was spent on, even after an SPA URL change.
    send('engagement', { u: engagedUrl, e: ms, sd: Math.max(maxScroll, scrollDepth()) })
    engagedMs = 0
    visibleSince = d.visibilityState === 'visible' ? Date.now() : null
  }

  if (engage) {
    d.addEventListener('visibilitychange', function () {
      if (d.visibilityState === 'visible') { visibleSince = Date.now(); return }
      if (visibleSince) engagedMs += Date.now() - visibleSince
      visibleSince = null
      flushEngagement()
    })
    w.addEventListener('scroll', function () { maxScroll = Math.max(maxScroll, scrollDepth()) }, { passive: true })
    w.addEventListener('pagehide', flushEngagement)
  }

  // The name of the browser's time zone ("Europe/Berlin"), sent as tz on
  // every hit. The server compares it with the country of the request: a
  // browser on a server is rarely in the zone its address is in.
  var zone = ''
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) {}

  // Interaction: whether a real input happened on this page, sent as i (0 or
  // 1) on every hit. A yes or no only: nothing about the input, where it was
  // or when. Bots that load a page and leave produce none. A scroll is not
  // counted, because a script can scroll.
  var INPUTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']
  var interacted = 0

  function onInput(event) {
    if (!event.isTrusted) return
    interacted = 1
    INPUTS.forEach(function (name) { w.removeEventListener(name, onInput, true) })
    // Before the first pageview there is nothing to add to: it carries i.
    if (lastPath === null) return
    // Say so now, an unload ping can get lost.
    if (engage) flushEngagement(true)
    else send('engagement', { u: engagedUrl, e: 0 })
  }

  INPUTS.forEach(function (name) { w.addEventListener(name, onInput, { capture: true, passive: true }) })

  function pageview(options) {
    options = options || {}
    var path = loc.pathname + routeHash()
    if (!options.force && path === lastPath) return
    flushEngagement()
    var extra = { p: merge(globalProps, options.props) }
    lastPath = path
    send('pageview', extra)
    currentUrl = loc.href
    engagedUrl = pageUrl()
    resetEngagement()
  }

  // Hash mode keeps every #fragment. Automatic mode keeps only route-like
  // ones (#/about, #!/about), so plain anchors don't count as pages.
  function keepsHash(hash) {
    return hashMode || (spaMode === 'auto' && /^#!?\//.test(hash))
  }

  function routeHash() {
    return keepsHash(loc.hash) ? loc.hash : ''
  }

  function onNavigate() {
    // Referrer for an SPA pageview is the page we navigated away from.
    previousUrl = currentUrl
    spaNavigation = true
    setTimeout(pageview, 0)
  }

  function track(name, props, callback) {
    if (typeof props === 'function') { callback = props; props = {} }
    send('event', { n: String(name), p: merge(globalProps, props) }, callback)
  }

  // <a data-privatus-event="signup" data-privatus-prop-plan="pro">
  function declarative(event) {
    var el = event.target.closest && event.target.closest('[data-privatus-event]')
    if (!el || (event.type === 'click' && el.tagName === 'FORM')) return
    if (event.type === 'submit' && el.tagName !== 'FORM') return
    var props = {}
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i]
      if (a.name.indexOf('data-privatus-prop-') === 0) props[a.name.slice(19).replace(/-/g, '_')] = a.value
    }
    track(el.getAttribute('data-privatus-event'), props)
  }

  var api = {
    track: track,
    pageview: function (options) { pageview(merge({ force: true }, options)) },
    props: function (props) { globalProps = merge(globalProps, props) },
    optOut: function () { try { w.localStorage.setItem('privatus_optout', '1') } catch (e) { /* storage blocked */ } },
    optIn: function () { try { w.localStorage.removeItem('privatus_optout') } catch (e) { /* storage blocked */ } },
    isOptedOut: optedOut,
    ready: function (fn) { fn() },
    _send: send,
    _attr: attr,
    // The minimised page URL: data-exclude applied (null when excluded),
    // data-mask applied, and only the allowed query parameters kept. The
    // ask module reports the same URL a pageview does.
    _url: pageUrl,
    // The overlay's pass, given once.
    _takePass: function () { var pass = overlayPass; overlayPass = null; return pass }
  }

  function start() {
    var queued = w[ns] && w[ns].q
    w[ns] = api
    if (queued) queued.forEach(function (call) { api[call[0]] && api[call[0]].apply(api, call[1]) })
    d.addEventListener('click', declarative, true)
    d.addEventListener('submit', declarative, true)
    if (spaMode !== 'off') {
      if (spaMode !== 'hash' && w.history && history.pushState) {
        var push = history.pushState
        history.pushState = function () { push.apply(this, arguments); onNavigate() }
        w.addEventListener('popstate', onNavigate)
      }
      if (hashMode || spaMode === 'auto') w.addEventListener('hashchange', onNavigate)
    }
    w.addEventListener('pageshow', function (e) { if (e.persisted) pageview({ force: true }) })
    // The overlay names elements the way the click module does, so that
    // module is loaded first.
    modules.forEach(function (name) { if (name !== 'engage' && !(overlayOpen && name === 'clicks')) load(name) })
    if (overlayOpen) load('clicks', function () { load('overlay') })
    if (!manual) pageview()
  }

  function load(name, done) {
    var el = d.createElement('script')
    el.src = origin + '/js/pa.' + name.replace(/[^a-z]/g, '') + '.js'
    el.defer = true
    el.setAttribute('data-namespace', ns)
    if (done) el.onload = el.onerror = done
    d.head.appendChild(el)
  }

  if (d.prerendering) d.addEventListener('prerenderingchange', start, { once: true })
  else start()
})()
