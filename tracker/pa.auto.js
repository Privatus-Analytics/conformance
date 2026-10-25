/*! Privatus Analytics · auto-capture module · MIT
 * Outbound links, file downloads, mailto/tel links, form submits and 404s.
 */
(function () {
  'use strict'
  var w = window, d = document
  var ns = (d.currentScript && d.currentScript.getAttribute('data-namespace')) || 'privatus'
  var pa = w[ns]
  if (!pa || !pa.track) return
  var FILES = /\.(pdf|zip|gz|tgz|rar|7z|dmg|exe|msi|pkg|deb|rpm|apk|ipa|csv|xlsx?|docx?|pptx?|odt|ods|txt|rtf|epub|mobi|mp3|mp4|mov|avi|wav|webm|iso|json|xml|svg)$/i

  d.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]')
    if (!link || link.hasAttribute('data-privatus-event')) return
    var href = link.getAttribute('href')
    if (/^mailto:/i.test(href)) return pa.track('Email Link', { to_domain: href.split('@')[1] || '' })
    if (/^tel:/i.test(href)) return pa.track('Phone Link')
    var url
    try { url = new URL(link.href) } catch (e) { return }
    if (FILES.test(url.pathname)) return pa.track('File Download', { file: url.pathname.split('/').pop(), host: url.host })
    if (/^https?:$/.test(url.protocol) && url.host !== location.host) {
      pa.track('Outbound Link', { domain: url.host.replace(/^www\./, ''), url: url.origin + url.pathname })
    }
  }, true)

  d.addEventListener('submit', function (event) {
    var form = event.target
    if (!form || form.hasAttribute('data-privatus-event')) return
    pa.track('Form Submit', { form: form.getAttribute('id') || form.getAttribute('name') || form.getAttribute('action') || '' })
  }, true)

  var notFound = d.querySelector('meta[name="privatus-404"]') || /\b404\b|not found/i.test(d.title)
  if (notFound) pa.track('404', { path: location.pathname })
})()
