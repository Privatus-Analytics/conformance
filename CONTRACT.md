# The example app contract

Every Privatus Analytics language package ships a small example app in
`example/`. The conformance suite builds it, opens it in a real browser
(Chromium), loads the real tracker from a mock collector and checks what
reaches the collector. This file says exactly what the app must do.

## Build

- `example/Dockerfile` builds the app. **The build context is the package
  folder**, not `example/`, so the Dockerfile can copy the package source:

  ```sh
  docker build -f example/Dockerfile .   # run in the package folder
  ```

- Install the package **from that source** (a path dependency, a `replace`
  line, `pip install /pkg`), never from a registry. The suite tests the code
  in the repo, not the last release.
- Keep anything you add outside `example/` to a `.dockerignore` (and
  `.gitignore`) in the package folder.
- Use an official image for the language. Small is better.

## Run

- Listen on port **8080** on all interfaces (`0.0.0.0`). `PORT` is also set
  to `8080`.
- Read the site id from `PRIVATUS_SITE_ID` and the script host from
  `PRIVATUS_SCRIPT_HOST`, the normal way the package does (the suite sets
  them to `pa_CONFORMANCE1` and `http://mock:4000`).
- **Force the tag on** (`enabled: true` or the package's word for it), so
  the tag prints whatever the environment.
- Answer `GET /` within a few minutes of starting. The suite waits up to
  180 seconds for the first answer.
- Use a server that copes with a browser's spare connections. (A Python
  `gunicorn` with sync workers does not: use `--worker-class gthread`.)

## Shared values

```text
page props  {plan: "pro", role: "admin", beta: true, seats: 3}
            beta is a boolean and seats a number, not strings
nonce       testnonce
nasty       </script><script>window.__pwned=1</script>  + U+2028 + U+2029 + &<>"'
            exactly: "</script><script>window.__pwned=1</script>  &<>\"'"
```

## Routes

All routes answer `200` with `text/html`. Every page has a normal
`<html><head>…</head><body>…</body></html>` shape.

### `GET /`

- The tag inside `<head>`, printed with the package's **normal template
  helper** (the one the README tells people to use), with:
  - the page props above,
  - the queue stub on.
- If the framework or package supports a Content Security Policy nonce, use
  the nonce `testnonce`, the way a real app would (the framework's own nonce
  if it has one, otherwise the package's nonce option). Send a matching
  header:

  ```text
  Content-Security-Policy: script-src 'nonce-testnonce' http://mock:4000
  ```

  (Use the value of `PRIVATUS_SCRIPT_HOST` for the origin.) Without nonce
  support, send no Content-Security-Policy header; the suite then skips the
  nonce checks.

### `GET /event`

The same `<head>` as `/` (tag, page props, queue stub). In the body:

- a button made with the package's **event helper**:
  name `Report exported`, props `{format: "csv", source: "toolbar"}`.
  `type="button"`, so a click does not leave the page;
- a link made with the package's **click helper**: name `pricing.cta`, with
  `href="#pricing"` so the click stays on the page;
- a form made with the event helper: name `Signup form`,
  `action="/event" method="get"`, with one `<button type="submit">`.

```html
<button type="button" data-privatus-event="Report exported" data-privatus-prop-format="csv" data-privatus-prop-source="toolbar">Export report</button>
<a href="#pricing" data-privatus-click="pricing.cta">Pricing</a>
<form action="/event" method="get" data-privatus-event="Signup form"><button type="submit">Sign up</button></form>
```

### `GET /nasty`

The same `<head>` as `/`, but the page props also hold `nasty: <nasty>`.
In the body, one button made with the event helper: name `Nasty value`,
props `{nasty: <nasty>}`. Do not escape the value yourself: the package
must do it.

### `GET /auto`

A plain HTML page with a `<head>` and **no tag** in it, served through the
package's **auto inject** middleware or filter, which adds the tag. Turn
auto inject on for this route only (mount the middleware on it, or a
second app instance), so the other routes test the helper alone.

If the package has no auto inject, answer `404`. The suite then skips the
test.

### `GET /off`

The tag helper called with **enabled forced off** (and the page props, no
queue stub). It must print nothing. Put the call alone between two marker
tags, so the suite can see that nothing was printed:

```html
<head>
<meta charset="utf-8">
<title>Off</title>
<meta name="privatus-off-start">{{ the tag helper, enabled off }}<meta name="privatus-off-end">
</head>
```

## What the suite checks

For `/`, `/event` and `/nasty`:

- one tracker tag in `<head>`, with `defer`, `src="http://mock:4000/js/pa.js"`,
  `data-site="pa_CONFORMANCE1"` and `data-props="privatusPageProps"`;
- the queue stub and the props script come before it (on `/`), each with the
  nonce when there is a policy;
- `pa.js` loads, `window.privatus` is the real tracker, and there are no
  policy violations, console errors or failed requests;
- a pageview reaches the collector with the site id and the page props,
  with `beta` a boolean and `seats` a number.

On `/` it also calls `privatus.track` while `pa.js` is held back, and checks
that the queue stub keeps the call until the tracker sends it.

On `/event`:

- one click on the button sends **exactly one** `Report exported` event with
  `format` and `source`;
- submitting the form sends `Signup form`;
- the click map module (loaded by the suite when the tag does not load it)
  reports the click on the link as `[data-privatus-click="pricing.cta"]`.

On `/nasty`: `window.__pwned` stays undefined, and the nasty value comes back
exactly the same from `privatusPageProps()`, from the pageview, from the
DOM attribute and from the click event.

On `/auto`: the tag is there exactly once, `Content-Length` (when sent)
matches the new body, and a pageview arrives.

On `/off`: nothing between the markers, no tracker, no hits.

## Things to know

- The browser reaches the app at `http://example-app:8080`. The real tracker
  sends nothing from `localhost`, so never test at `localhost`.
- The real tracker sends nothing from an automated browser
  (`navigator.webdriver`). The suite hides that flag, as a person's browser
  would have it.
