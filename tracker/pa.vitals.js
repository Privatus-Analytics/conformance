/*! Privatus Analytics · Web Vitals module · MIT
 * LCP, INP, CLS, FCP and TTFB, sent once when the page is hidden.
 */
(function () {
  'use strict'
  var w = window, d = document
  var ns = (d.currentScript && d.currentScript.getAttribute('data-namespace')) || 'privatus'
  var pa = w[ns]
  if (!pa || !pa._send || !w.PerformanceObserver) return
  var values = {}, sent = false, cls = 0, inp = 0

  function observe(type, callback, options) {
    try {
      new PerformanceObserver(function (list) { list.getEntries().forEach(callback) })
        .observe(Object.assign({ type: type, buffered: true }, options || {}))
    } catch (e) { /* unsupported entry type */ }
  }

  // A page opened in a background tab paints only when the person switches
  // to it, so its LCP and FCP measure how long they took to look. Like the
  // web-vitals library, ignore paints from after the page was first hidden
  // and take prerendered pages from their activation.
  var navEntry = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]
  var activation = (navEntry && navEntry.activationStart) || 0
  var firstHidden = d.visibilityState === 'hidden' && !d.prerendering ? 0 : Infinity
  d.addEventListener('visibilitychange', function () {
    if (d.visibilityState === 'hidden' && firstHidden === Infinity) firstHidden = performance.now()
  }, true)

  function paint(e) { return e.startTime < firstHidden ? Math.max(e.startTime - activation, 0) : null }
  observe('largest-contentful-paint', function (e) { var v = paint(e); if (v !== null) values.LCP = v })
  observe('paint', function (e) {
    var v = e.name === 'first-contentful-paint' ? paint(e) : null
    if (v !== null) values.FCP = v
  })
  observe('layout-shift', function (e) { if (!e.hadRecentInput) { cls += e.value; values.CLS = cls } })
  observe('event', function (e) {
    if (e.interactionId && e.duration > inp) { inp = e.duration; values.INP = inp }
  }, { durationThreshold: 40 })
  if (navEntry) values.TTFB = Math.max(navEntry.responseStart - activation, 0)

  // Once per page: visibilitychange usually comes first, pagehide covers
  // browsers that skip it (it may fire while still "visible").
  function flush(force) {
    if (sent || (force !== true && d.visibilityState !== 'hidden')) return
    sent = true
    Object.keys(values).forEach(function (name) {
      var value = name === 'CLS' ? Math.round(values[name] * 1000) / 1000 : Math.round(values[name])
      pa._send('vital', { n: name, v: value })
    })
  }
  d.addEventListener('visibilitychange', flush)
  w.addEventListener('pagehide', function () { flush(true) })
})()
