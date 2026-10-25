/*! Privatus Analytics · click overlay · MIT
 * Loaded only when a site's member opens a page from their click map
 * (#privatus-overlay=...), never for visitors. It reads the page's click
 * counts with the member's pass and draws them on the page: how many
 * visits clicked each element, and which elements on screen nobody
 * clicked. It sends nothing about the page and keeps nothing in the
 * browser.
 */
(function () {
  'use strict'
  var w = window, d = document
  var ns = (d.currentScript && d.currentScript.getAttribute('data-namespace')) || 'privatus'
  var pa = w[ns]
  if (!pa || !pa._takePass || !pa._clickName || !w.fetch || !d.body) return
  var pass = pa._takePass()
  if (!pass) return

  var ENDPOINT = '__PA_TRACKER_ORIGIN__/api/overlay'
  var TARGETS = 'a,button,input,select,label,summary,[role=button],[data-privatus-click]'
  var MAX_ELEMENTS = 400
  var BRAND = '6,117,91'
  // Written as escapes: the page may not be read as UTF-8.
  var DOT = ' \u00b7 ', CROSS = '\u00d7'
  var state = { period: '30d', device: '', url: null, data: null, showUnclicked: true, unclicked: [] }
  var byName = {}, maxShare = 0, frame = 0, timer = 0, watch = 0

  var host = d.createElement('div')
  host.setAttribute('data-privatus-overlay', '')
  // Left out of the copy Turbo keeps for Back, which would hold an empty
  // clone of it.
  host.setAttribute('data-turbo-temporary', '')
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647'
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
  var style = d.createElement('style')
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.layer{position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;overflow:hidden}',
    '.box{position:absolute;border:2px solid;border-radius:4px}',
    '.box.none{border:2px dashed #d97706;background:rgba(217,119,6,.06)}',
    '.badge{position:absolute;transform:translate(-50%,-60%);padding:1px 6px;border-radius:9px;font-size:11px;font-weight:600;line-height:16px;color:#fff;white-space:nowrap;pointer-events:auto;cursor:default}',
    '.badge.none{background:#d97706}',
    '.panel{position:fixed;right:16px;bottom:16px;width:300px;max-height:70vh;overflow:auto;pointer-events:auto;background:#fff;color:#171717;border:1px solid #d4d4d4;border-radius:8px;font-size:13px;line-height:1.4}',
    '.head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #e5e5e5;font-weight:600}',
    '.close{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#525252;padding:2px 6px}',
    '.row{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #f5f5f5}',
    'select{flex:1;min-width:0;font-size:12px;padding:4px;border:1px solid #d4d4d4;border-radius:4px;background:#fff;color:#171717}',
    '.sum{padding:8px 12px;color:#525252}',
    '.sum b{color:#171717}',
    'ol{list-style:none;margin:0;padding:0 0 4px}',
    'li{display:flex;justify-content:space-between;gap:8px;padding:5px 12px;cursor:pointer}',
    'li:hover{background:#f5f5f5}',
    'code{font-family:ui-monospace,Menlo,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.num{font-variant-numeric:tabular-nums;color:#525252;white-space:nowrap}',
    '.none-head{display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid #e5e5e5;font-weight:600}',
    '.hint{padding:0 12px 8px;color:#737373;font-size:12px}',
    '.empty{padding:12px;color:#737373}',
    '@media (max-width:480px){.panel{left:8px;right:8px;bottom:8px;width:auto;max-height:40vh}}',
    '@media (prefers-color-scheme:dark){.panel{background:#171717;color:#f5f5f5;border-color:#404040}.head,.none-head{border-color:#404040}.row{border-color:#262626}li:hover{background:#262626}select{background:#262626;color:#f5f5f5;border-color:#404040}.sum{color:#a3a3a3}.sum b{color:#f5f5f5}.close{color:#a3a3a3}}'
  ].join('')
  var layer = el('div', 'layer')
  var panel = el('aside', 'panel')
  root.appendChild(style)
  root.appendChild(layer)
  root.appendChild(panel)
  d.body.appendChild(host)

  function el(tag, cls, text) {
    var node = d.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }

  function label(key) { return (state.data && state.data.labels[key]) || '' }

  // A name the site gave is shown as the name alone.
  function display(selector) {
    var name = /^\[data-privatus-click="(.+)"\]$/.exec(selector)
    return name ? name[1] : selector
  }

  function number(n) { try { return n.toLocaleString() } catch (e) { return String(n) } }

  // The page's own clickable elements that are drawn on screen, and how a
  // click on each is named.
  function elements() {
    var found = d.querySelectorAll(TARGETS)
    var list = []
    for (var i = 0; i < found.length && list.length < MAX_ELEMENTS; i++) {
      var node = found[i]
      if (host.contains(node)) continue
      var rect = node.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      // Not drawn: inside a closed <details>, hidden or see-through.
      if (node.checkVisibility && !node.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) continue
      list.push({ node: node, name: pa._clickName(node) })
    }
    return list
  }

  function fetchData() {
    state.url = pa._url()
    if (!state.url) return close()
    var body = { t: pass, u: state.url, period: state.period }
    if (state.device) body.device = state.device
    // pa._url keeps the # only for a site in hash mode: its pages are
    // stored with it, so the read says so, as a hit does.
    if (state.url.indexOf('#') >= 0) body.h = 1
    w.fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(body), credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })
      .then(function (response) { return response.ok ? response.json() : Promise.reject(response.status) })
      .then(function (json) {
        state.data = json.data
        byName = {}
        maxShare = 0
        state.data.elements.forEach(function (row) {
          byName[row.selector] = row
          maxShare = Math.max(maxShare, row.visit_share || 0)
        })
        renderPanel()
        draw()
      }, close)
  }

  function share(row) { return state.data.page_visits ? row.visit_share + '%' : number(row.clicks) }

  function title(row, count) {
    var text = display(row.selector) + DOT + label('clicks') + ': ' + number(row.clicks)
    if (state.data.page_visits) text += DOT + row.visit_share + '% ' + label('share')
    if (count > 1) text += '\n' + label('shared_by').replace('%{count}', count)
    return text
  }

  function draw() {
    frame = 0
    if (!state.data) return
    layer.textContent = ''
    var list = elements()
    var counts = {}
    list.forEach(function (item) { counts[item.name] = (counts[item.name] || 0) + 1 })
    var unclicked = []
    list.forEach(function (item) {
      var row = byName[item.name]
      if (!row) unclicked.push(item)
      if (!row && !state.showUnclicked) return
      var rect = item.node.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > w.innerHeight || rect.right < 0 || rect.left > w.innerWidth) return
      var box = el('div', row ? 'box' : 'box none')
      box.style.cssText += ';left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px'
      var badge = el('div', row ? 'badge' : 'badge none', row ? share(row) : '0')
      badge.style.left = (rect.left + rect.width) + 'px'
      // Kept inside the window, so a badge at the very top can be read.
      badge.style.top = Math.max(rect.top, 10) + 'px'
      if (row) {
        var heat = maxShare ? 0.35 + 0.65 * ((row.visit_share || 0) / maxShare) : 1
        box.style.borderColor = 'rgba(' + BRAND + ',' + heat + ')'
        badge.style.background = 'rgba(' + BRAND + ',' + Math.max(heat, 0.8) + ')'
        badge.title = title(row, counts[item.name])
      } else {
        badge.title = display(item.name) + '\n' + label('not_clicked_hint')
      }
      layer.appendChild(box)
      layer.appendChild(badge)
    })
    if (unclicked.length !== state.unclicked.length) { state.unclicked = unclicked; renderUnclicked() }
    state.unclicked = unclicked
  }

  function schedule() { if (!frame) frame = w.requestAnimationFrame(draw) }

  function find(name) {
    var list = elements()
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i].node
    return null
  }

  function show(name) {
    var node = find(name)
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function select(options, value, onChange, aria) {
    var node = el('select')
    node.setAttribute('aria-label', aria)
    options.forEach(function (option) {
      var opt = el('option', null, option[1])
      opt.value = option[0]
      if (option[0] === value) opt.selected = true
      node.appendChild(opt)
    })
    node.addEventListener('change', function () { onChange(node.value) })
    return node
  }

  var unclickedNode = null

  function renderPanel() {
    panel.textContent = ''
    var head = el('div', 'head', label('title'))
    var shut = el('button', 'close', CROSS)
    shut.type = 'button'
    shut.setAttribute('aria-label', label('close'))
    shut.addEventListener('click', close)
    head.appendChild(shut)
    panel.appendChild(head)

    var row = el('div', 'row')
    row.appendChild(select(['7d', '30d', '90d'].map(function (p) { return [p, label('periods.' + p)] }), state.period,
      function (value) { state.period = value; fetchData() }, label('period')))
    row.appendChild(select([['', label('all_devices')]].concat(['desktop', 'mobile', 'tablet'].map(function (k) { return [k, label('devices.' + k)] })),
      state.device, function (value) { state.device = value; fetchData() }, label('device')))
    panel.appendChild(row)

    var sum = el('div', 'sum', label('visits') + ': ')
    sum.appendChild(el('b', null, number(state.data.page_visits || 0)))
    panel.appendChild(sum)

    if (!state.data.elements.length) panel.appendChild(el('div', 'empty', label('no_data')))
    var list = el('ol')
    state.data.elements.slice(0, 15).forEach(function (item) {
      var li = el('li')
      li.appendChild(el('code', null, display(item.selector)))
      li.appendChild(el('span', 'num', number(item.clicks) + (state.data.page_visits ? DOT + item.visit_share + '%' : '')))
      li.title = title(item, 1)
      li.addEventListener('click', function () { show(item.selector) })
      list.appendChild(li)
    })
    panel.appendChild(list)
    unclickedNode = el('div')
    panel.appendChild(unclickedNode)
    renderUnclicked()
  }

  function renderUnclicked() {
    if (!unclickedNode || !state.data) return
    unclickedNode.textContent = ''
    var head = el('label', 'none-head')
    var box = el('input')
    box.type = 'checkbox'
    box.checked = state.showUnclicked
    box.addEventListener('change', function () { state.showUnclicked = box.checked; schedule() })
    head.appendChild(box)
    head.appendChild(d.createTextNode(label('not_clicked') + DOT + number(state.unclicked.length)))
    unclickedNode.appendChild(head)
    unclickedNode.appendChild(el('div', 'hint', label('not_clicked_hint')))
    var seen = {}
    var list = el('ol')
    state.unclicked.forEach(function (item) {
      if (seen[item.name] || list.childNodes.length >= 15) return
      seen[item.name] = true
      var li = el('li')
      li.appendChild(el('code', null, display(item.name)))
      li.addEventListener('click', function () { show(item.name) })
      list.appendChild(li)
    })
    unclickedNode.appendChild(list)
  }

  // A page that changes without a reload (Turbo, an SPA) gets the numbers
  // of its new address. New elements are drawn as they appear.
  function changed() {
    clearTimeout(timer)
    timer = setTimeout(function () {
      if (!host.isConnected) d.body.appendChild(host)
      if (pa._url() !== state.url) fetchData()
      else schedule()
    }, 250)
  }

  var observer = w.MutationObserver ? new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) if (!host.contains(records[i].target) && records[i].target !== host) return changed()
  }) : null

  // Escape closes the overlay. Heard before the page's own keys (which may
  // stop it), and left to an open menu first.
  function onKey(event) { if (event.key === 'Escape' && !d.querySelector('details[open]')) close() }

  function close() {
    if (observer) observer.disconnect()
    clearInterval(watch)
    w.removeEventListener('scroll', schedule, true)
    w.removeEventListener('resize', schedule)
    w.removeEventListener('keydown', onKey, true)
    if (host.parentNode) host.parentNode.removeChild(host)
    state.data = null
  }

  if (observer) observer.observe(d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] })
  w.addEventListener('scroll', schedule, { capture: true, passive: true })
  w.addEventListener('resize', schedule)
  w.addEventListener('keydown', onKey, true)
  watch = setInterval(function () { if (pa._url() !== state.url) changed() }, 1000)
  fetchData()
})()
