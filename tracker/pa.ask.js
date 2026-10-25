/*! Privatus Analytics · ask module (surveys) · MIT
 * Cookieless on-site surveys. No cookies, no localStorage, no sessionStorage
 * and no identifier of any kind: the server decides what to show and
 * remembers only that someone on this network and browser was asked today,
 * as a daily hash it cannot reverse.
 *
 * Styles are set through the CSSOM (element.style), which a Content Security
 * Policy does not restrict, so no style-src exception is needed.
 */
(function () {
  'use strict'
  var w = window, d = document, nav = navigator
  var script = d.currentScript
  var ns = (script && script.getAttribute('data-namespace')) || 'privatus'
  var pa = w[ns]
  if (!pa || !pa._attr || !w.fetch || !d.body) return

  var site = pa._attr('site')
  var origin = pa._attr('api') || scriptOrigin()
  var debug = pa._attr('debug') === 'true'
  if (!site) return

  // One card at a time, and never a second one on the same page view.
  var offered = null, card = null, finished = false, step = 0
  var replies = {}, words = {}

  function scriptOrigin() {
    try { return new URL(script.src).origin } catch (e) { return '' }
  }

  function flags(into) {
    if (nav.doNotTrack === '1') into.push('dnt=1')
    if (nav.globalPrivacyControl) into.push('gpc=1')
    return into
  }

  function log(message) { if (debug) console.info('[privatus/ask] ' + message) }

  function post(body) {
    body.s = site
    if (nav.doNotTrack === '1') body.d = 1
    if (nav.globalPrivacyControl) body.g = 1
    body.u = pageUrl()
    try {
      w.fetch(origin + '/api/survey', {
        method: 'POST', body: JSON.stringify(body), keepalive: true,
        credentials: 'omit', headers: { 'Content-Type': 'text/plain' }
      })
    } catch (e) { /* the answer is lost, the page is not */ }
  }

  // The same minimised URL a pageview reports: data-mask applied, and
  // nothing for a page data-exclude leaves out.
  function pageUrl() {
    return (pa._url && pa._url()) || location.href
  }

  function load() {
    if (pa.isOptedOut && pa.isOptedOut()) return log('opted out')
    if (pa._url && !pa._url()) return log('page excluded')
    var query = flags(['s=' + encodeURIComponent(site),
      'u=' + encodeURIComponent(pageUrl())])
    w.fetch(origin + '/api/surveys?' + query.join('&'), { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (body) {
        var list = body && body.data
        if (!list || !list.length) return log('nothing to ask')
        offered = list[0]
        words = offered.labels || {}
        arm(offered)
      }, function () { /* offline, or blocked: no survey, no error */ })
  }

  // ---- triggers ----------------------------------------------------------

  function arm(survey) {
    var trigger = survey.trigger || {}
    switch (trigger.kind) {
      case 'immediate': return show()
      case 'delay': return w.setTimeout(show, (trigger.delay_seconds || 0) * 1000)
      case 'scroll': return onScroll(trigger.scroll_percent || 50)
      case 'exit': return onExit()
      default: return log('waiting for ' + ns + '.ask()')
    }
  }

  function onScroll(percent) {
    var handler = function () {
      if (depth() < percent) return
      w.removeEventListener('scroll', handler)
      show()
    }
    w.addEventListener('scroll', handler, { passive: true })
    handler()
  }

  function depth() {
    var el = d.documentElement, body = d.body || {}
    var top = el.scrollTop || body.scrollTop || 0
    var height = Math.max(el.scrollHeight, body.scrollHeight || 0) - el.clientHeight
    return height > 0 ? Math.min(100, Math.round((top / height) * 100)) : 100
  }

  // Leaving through the top of the window on a desktop pointer. On a touch
  // screen there is no such signal, so a fast scroll back to the top of a
  // page the visitor has read most of stands in for it.
  function onExit() {
    var coarse = w.matchMedia && w.matchMedia('(pointer: coarse)').matches
    if (!coarse) {
      return d.addEventListener('mouseout', function (event) {
        if (event.clientY <= 0 && !event.relatedTarget) show()
      })
    }
    var furthest = 0, last = 0
    w.addEventListener('scroll', function () {
      var now = depth()
      furthest = Math.max(furthest, now)
      if (furthest >= 50 && now < 15 && last > now) show()
      last = now
    }, { passive: true })
  }

  // ---- the card ----------------------------------------------------------

  var DARK = w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches
  var CALM = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches
  var INK = DARK ? '#fafafa' : '#171717'
  var MUTED = DARK ? '#a3a3a3' : '#525252'
  var PAPER = DARK ? '#171717' : '#ffffff'
  var EDGE = DARK ? '#404040' : '#e5e5e5'
  var FIELD = DARK ? '#262626' : '#ffffff'
  var ACCENT = '#06755b'
  var FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,' +
    'Helvetica,Arial,sans-serif'

  function el(tag, css, text) {
    var node = d.createElement(tag)
    if (css) node.style.cssText = css
    if (text != null) node.textContent = text
    return node
  }

  function place(position) {
    if (position === 'center') {
      return 'left:50%;bottom:24px;transform:translateX(-50%);'
    }
    return (position === 'bottom_left' ? 'left:' : 'right:') + '24px;bottom:24px;'
  }

  function show() {
    if (card || finished || !offered) return
    if (pa.isOptedOut && pa.isOptedOut()) return
    card = el('div',
      'position:fixed;z-index:2147483000;' + place(offered.position) +
      'width:min(360px,calc(100vw - 32px));box-sizing:border-box;' +
      'background:' + PAPER + ';color:' + INK + ';border:1px solid ' + EDGE +
      ';border-radius:10px;padding:16px;font:14px/1.5 ' + FONT +
      ';text-align:left;' + (CALM ? '' : 'opacity:0;transition:opacity .2s;'))
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', words.title || '')
    card.appendChild(closer())
    d.body.appendChild(card)
    if (!CALM) w.setTimeout(function () { card.style.opacity = '1' }, 10)
    d.addEventListener('keydown', onKey)
    post({ id: offered.id, k: 'shown' })
    render()
  }

  function closer() {
    var button = el('button',
      'position:absolute;top:8px;right:8px;width:28px;height:28px;' +
      'border:0;background:none;color:' + MUTED + ';font-size:18px;' +
      'line-height:1;cursor:pointer;border-radius:6px;', '×')
    button.setAttribute('aria-label', words.close || '')
    button.addEventListener('click', function () { close('dismiss') })
    return button
  }

  function onKey(event) {
    if (event.key === 'Escape' && card) close('dismiss')
  }

  function close(kind) {
    if (!card) return
    var answers = collected()
    if (kind === 'dismiss' && answers.length) post({ id: offered.id, k: 'dismiss', a: answers })
    remove()
  }

  function remove() {
    d.removeEventListener('keydown', onKey)
    if (card && card.parentNode) card.parentNode.removeChild(card)
    card = null
    finished = true
  }

  function collected() {
    var out = []
    for (var key in replies) {
      if (Object.prototype.hasOwnProperty.call(replies, key)) {
        out.push({ q: key, v: replies[key] })
      }
    }
    return out
  }

  // ---- questions ---------------------------------------------------------

  function body() {
    var existing = card.querySelector('[data-pa-body]')
    if (existing) card.removeChild(existing)
    var node = el('div', 'padding-right:24px;')
    node.setAttribute('data-pa-body', '1')
    card.appendChild(node)
    return node
  }

  function render() {
    var questions = offered.questions || []
    var question = questions[step]
    if (!question) return thanks()
    var into = body()
    into.appendChild(el('p', 'margin:0 0 12px;font-weight:600;', question.prompt))
    var field = fieldFor(question, into)
    into.appendChild(footer(question, questions.length))
    if (field && field.focus) { try { field.focus() } catch (e) { /* ignore */ } }
  }

  function fieldFor(question, into) {
    switch (question.kind) {
      case 'text': return textField(question, into)
      case 'choice': return choiceField(question, into, false)
      case 'multi': return choiceField(question, into, true)
      case 'rating': return scaleField(question, into, 1, question.scale || 5)
      case 'nps': return scaleField(question, into, 0, 10)
      case 'yes_no': return yesNoField(question, into)
      default: return null
    }
  }

  function textField(question, into) {
    var box = el('textarea',
      'width:100%;box-sizing:border-box;min-height:72px;padding:8px;' +
      'border:1px solid ' + EDGE + ';border-radius:6px;background:' + FIELD +
      ';color:' + INK + ';font:inherit;resize:vertical;')
    box.setAttribute('aria-label', question.prompt)
    box.addEventListener('input', function () {
      set(question, box.value.trim() || null)
    })
    into.appendChild(box)
    return box
  }

  function choiceField(question, into, many) {
    var list = el('div', 'display:flex;flex-direction:column;gap:6px;')
    var chosen = []
    ;(question.choices || []).forEach(function (choice) {
      var button = choiceButton(choice)
      button.addEventListener('click', function () {
        if (!many) {
          set(question, choice)
          return advance()
        }
        var at = chosen.indexOf(choice)
        if (at < 0) { chosen.push(choice) } else { chosen.splice(at, 1) }
        button.style.borderColor = at < 0 ? ACCENT : EDGE
        button.setAttribute('aria-pressed', at < 0 ? 'true' : 'false')
        set(question, chosen.length ? chosen.slice() : null)
      })
      list.appendChild(button)
    })
    into.appendChild(list)
    return list.firstChild
  }

  function choiceButton(label) {
    var button = el('button',
      'display:block;width:100%;text-align:left;padding:8px 10px;' +
      'border:1px solid ' + EDGE + ';border-radius:6px;background:' + FIELD +
      ';color:' + INK + ';font:inherit;cursor:pointer;', label)
    button.setAttribute('type', 'button')
    return button
  }

  function scaleField(question, into, min, max) {
    var row = el('div', 'display:flex;flex-wrap:wrap;gap:6px;')
    for (var value = min; value <= max; value++) {
      row.appendChild(scaleButton(question, value))
    }
    into.appendChild(row)
    return row.firstChild
  }

  function scaleButton(question, value) {
    var button = el('button',
      'flex:1 0 auto;min-width:32px;padding:8px 0;border:1px solid ' + EDGE +
      ';border-radius:6px;background:' + FIELD + ';color:' + INK +
      ';font:inherit;cursor:pointer;', String(value))
    button.setAttribute('type', 'button')
    button.addEventListener('click', function () {
      set(question, value)
      advance()
    })
    return button
  }

  function yesNoField(question, into) {
    var row = el('div', 'display:flex;gap:8px;')
    ;['yes', 'no'].forEach(function (value) {
      var button = choiceButton(value === 'yes' ? words.yes : words.no)
      button.style.width = 'auto'
      button.style.flex = '1'
      button.style.textAlign = 'center'
      button.addEventListener('click', function () {
        set(question, value)
        advance()
      })
      row.appendChild(button)
    })
    into.appendChild(row)
    return row.firstChild
  }

  function set(question, value) {
    if (value === null) { delete replies[question.key] } else { replies[question.key] = value }
  }

  // ---- moving on ---------------------------------------------------------

  function footer(question, total) {
    var row = el('div',
      'display:flex;align-items:center;justify-content:space-between;' +
      'gap:8px;margin-top:12px;')
    row.appendChild(el('span', 'color:' + MUTED + ';font-size:12px;',
      total > 1 ? (step + 1) + '/' + total : ''))
    var next = el('button',
      'padding:8px 14px;border:0;border-radius:6px;background:' + ACCENT +
      ';color:#fff;font:inherit;font-weight:500;cursor:pointer;',
      step + 1 >= total ? words.send : words.next)
    next.setAttribute('type', 'button')
    next.addEventListener('click', function () {
      if (question.required && replies[question.key] == null) return
      advance()
    })
    row.appendChild(next)
    return row
  }

  function advance() {
    step++
    if (step < (offered.questions || []).length) return render()
    submit()
  }

  function submit() {
    post({ id: offered.id, k: 'answer', a: collected(), done: 1 })
    thanks()
  }

  function thanks() {
    var into = body()
    into.appendChild(el('p', 'margin:0;font-weight:600;',
      offered.thank_you || words.thanks))
    w.setTimeout(remove, 3000)
  }

  // A survey whose trigger is "manual" waits for this call.
  pa.ask = function (id) {
    if (!offered || (id && id !== offered.id)) return false
    show()
    return true
  }

  load()
})()
