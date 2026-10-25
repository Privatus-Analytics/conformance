// A stand-in for the Privatus collector, for the conformance tests.
//
// - GET  /js/pa.js, /js/pa.<module>.js  the real tracker files (../tracker), with
//        __PA_TRACKER_ORIGIN__ filled in with this server's origin, as production
//        does when it serves them (PrivatusSecurity::ScriptOrigins in the web app).
// - POST /api/event  takes a hit the way the real endpoint does (IngestController#event):
//        a JSON object of at most 32 KB, short keys turned into long names
//        (Ingest::Payload::KEYS), answered 202 with no body. Every hit is kept in memory.
// - GET  /__hits     every hit so far, oldest first, as JSON.
// - POST /__reset    forgets every hit.
// - GET  /__health   "ok".
//
// Plain Node, no dependencies. Never use it for anything but tests.
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRACKER_DIR = process.env.TRACKER_DIR || join(HERE, '..', 'tracker')
const PORT = Number(process.env.PORT || 4000)
// The origin browsers reach this server at, for example http://mock:4000.
// Without it the Host header of each request is used.
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '')
const MAX_BODY = 32 * 1024
const PLACEHOLDER = /__PA_TRACKER_ORIGIN__/g

// Ingest::Payload::KEYS
const KEYS = {
  s: 'site', t: 'type', u: 'url', r: 'referrer', n: 'name', p: 'props', w: 'screen_width',
  l: 'language', e: 'engaged_ms', sd: 'scroll_depth', v: 'value', c: 'selector', d: 'dnt',
  g: 'gpc', rv: 'revenue', cu: 'currency', h: 'hash_mode', i: 'interacted', hp: 'honeypot',
  a: 'automation', tz: 'timezone', xp: 'preview', ch: 'challenge'
}
// Ingest::Payload::FLAGS and TRUTHY
const FLAGS = ['dnt', 'gpc', 'hash_mode', 'interacted', 'honeypot', 'challenge']
const TRUTHY = [true, 1, '1', 'true']
const TYPES = ['pageview', 'event', 'custom', 'engagement', 'vital', 'click']
const TEXTS = ['site', 'type', 'url', 'referrer', 'name', 'language', 'selector', 'currency',
  'automation', 'timezone', 'preview']
const NUMBERS = ['screen_width', 'engaged_ms', 'scroll_depth', 'value']

const scripts = new Map()
for (const file of readdirSync(TRACKER_DIR)) {
  if (/^pa(\.[a-z]+)?\.js$/.test(file)) scripts.set(file, readFileSync(join(TRACKER_DIR, file), 'utf8'))
}
if (!scripts.has('pa.js')) throw new Error(`No pa.js in ${TRACKER_DIR}. Run scripts/refresh-tracker.sh.`)

let hits = []
let seq = 0

function canonical(raw) {
  const data = {}
  for (const [key, value] of Object.entries(raw)) data[KEYS[key] || key] = value
  for (const flag of FLAGS) if (flag in data) data[flag] = TRUTHY.includes(data[flag])
  return data
}

const scalar = (v) => v === undefined || v === null || typeof v === 'string' || typeof v === 'number'
const number = (v) => scalar(v) && !(typeof v === 'number' && !Number.isFinite(v))

// Ingest::Payload.well_formed? plus a known type: what the real server keeps.
function problems(data) {
  const out = []
  for (const key of TEXTS) if (!scalar(data[key])) out.push(`${key} is not text`)
  for (const key of NUMBERS) if (!number(data[key])) out.push(`${key} is not a number`)
  if (!scalar(data.revenue)) out.push('revenue is not a number')
  if (!TYPES.includes(String(data.type))) out.push(`unknown type ${JSON.stringify(data.type)}`)
  if (!data.site) out.push('no site')
  if (data.props !== undefined && (typeof data.props !== 'object' || Array.isArray(data.props))) {
    out.push('props is not an object')
  }
  return out
}

function origin(req) {
  return PUBLIC_ORIGIN || `http://${req.headers.host}`
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '600')
}

function send(res, status, body, type = 'application/json') {
  res.statusCode = status
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', type)
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

// Ingest::RequestSite.json: a JSON object of at most 32 KB, otherwise {}.
function parse(text) {
  if (!text) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock')
  cors(res)
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') return send(res, 204)

  const script = url.pathname.match(/^\/js\/(pa(?:\.[a-z]+)?\.js)$/)
  if (script && (req.method === 'GET' || req.method === 'HEAD')) {
    const text = scripts.get(script[1])
    if (!text) return send(res, 404, 'not found', 'text/plain')
    const body = text.replace(PLACEHOLDER, origin(req))
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.statusCode = 200
    return res.end(req.method === 'HEAD' ? undefined : body)
  }

  if (url.pathname === '/api/event' && req.method === 'POST') {
    const text = await readBody(req)
    const raw = parse(text)
    const data = canonical(raw)
    hits.push({
      seq: ++seq,
      at: new Date().toISOString(),
      contentType: req.headers['content-type'] || null,
      origin: req.headers.origin || null,
      raw,
      data,
      problems: problems(data)
    })
    // The real endpoint answers every hit the same way, kept or dropped.
    return send(res, 202)
  }

  if (url.pathname === '/__hits' && req.method === 'GET') return send(res, 200, hits)
  if (url.pathname === '/__reset' && req.method === 'POST') {
    hits = []
    return send(res, 204)
  }
  if (url.pathname === '/__health') return send(res, 200, 'ok', 'text/plain')

  return send(res, 404, 'not found', 'text/plain')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mock collector on :${PORT}, origin ${PUBLIC_ORIGIN || '(from Host header)'}, ` +
    `scripts: ${[...scripts.keys()].join(', ')}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
