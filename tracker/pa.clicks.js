/*! Privatus Analytics · click map module · MIT
 * Counts clicks per element (a short CSS selector, or the name the site
 * gave it). No mouse movement, coordinates or text are collected.
 */
(function () {
  'use strict'
  var d = document
  var ns = (d.currentScript && d.currentScript.getAttribute('data-namespace')) || 'privatus'
  var pa = window[ns]
  if (!pa || !pa._send) return

  // Generated names are left out: three digits in a row (row-1234), or
  // eight capitals or digits in a row, the shape of a record's public id
  // or a token (site_pa_FB6X4OKLJS).
  function stable(name) { return !/\d{3,}|[A-Z0-9]{8,}/.test(name) }

  function part(el) {
    var s = el.tagName.toLowerCase()
    if (el.id && stable(el.id)) return s + '#' + el.id
    var classes = (el.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && stable(c) && c.indexOf(':') < 0 })
    return classes.length ? s + '.' + classes.slice(0, 2).join('.') : s
  }

  // Stops at the first element named by its id.
  function selector(el) {
    var parts = []
    while (el && el.nodeType === 1 && parts.length < 4 && el !== d.body) {
      parts.unshift(part(el))
      if (el.id && stable(el.id)) break
      el = el.parentElement
    }
    return parts.join(' > ')
  }

  // A name the site gave an element (data-privatus-click="nav.goals") is
  // sent in place of a selector, as one that finds it again. Letters,
  // digits, . _ : and - only, up to 100 characters: anything else is not
  // sent, and the element gets a selector like any other.
  var NAMED = '[data-privatus-click]:not([data-privatus-click=""])'
  function named(el) {
    var owner = el.closest && el.closest(NAMED)
    var name = owner && owner.getAttribute('data-privatus-click')
    return name && /^[\w.:-]{1,100}$/.test(name) ? '[data-privatus-click="' + name + '"]' : null
  }

  // How a click on this element is named: the overlay (pa.overlay.js)
  // finds each element's clicks with it.
  pa._clickName = function (el) { return named(el) || selector(el) }

  var last = 0
  d.addEventListener('click', function (event) {
    var now = Date.now()
    if (now - last < 300) return
    last = now
    var target = event.target.closest && event.target.closest('a,button,input,select,label,summary,[role=button],[data-privatus-click]')
    pa._send('click', { c: named(event.target) || selector(target || event.target) })
  }, true)
})()
