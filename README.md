# Privatus Analytics conformance tests

These tests check that each Privatus Analytics language package really works:
in a real browser, with the real tracker, end to end.

Each package ships a tiny example app. The tests start it next to a mock
collector (a small server that stands in for Privatus), open every page in
Chromium and check what the browser sends. A package passes when:

- the tag is in the page head, the tracker loads and nothing is blocked;
- pageviews and events reach the collector with the right site id and props;
- buttons, forms and click map names made with the package's helpers work;
- values with `</script>`, quotes and odd line breaks are escaped safely;
- auto inject adds the tag once;
- a tag turned off prints only the queue stub (when it is on), so
  `privatus.track` calls still work, and otherwise prints nothing.

What each example app must do is in [CONTRACT.md](CONTRACT.md).

## Run it

You need Docker with Compose. Nothing else: Node, the browser and every
language run inside containers.

```sh
./run.sh ../python      # one package (a folder with example/Dockerfile)
./run-all.sh            # every package next to this folder, then a table
./run-all.sh ~/src      # every package in another folder
```

`run.sh` exits with a non-zero code when anything fails. It removes its
containers and volumes when it is done. Reports go to `reports/<package>/`:

| File | What it holds |
|---|---|
| `html/index.html` | The Playwright report, with a trace for each failed test |
| `junit.xml` | Results for CI tools |
| `build.log` | The Docker build output |
| `services.log` | The example app's and the mock collector's logs |
| `run.log` | Everything `run.sh` printed (from `run-all.sh`) |

## What is inside

| Path | What it is |
|---|---|
| `mock/server.mjs` | The mock collector. Plain Node, no dependencies |
| `tracker/` | A pinned copy of the real tracker (`pa.js` and its modules) |
| `tests/` | The Playwright tests (TypeScript) |
| `docker-compose.yml` | The mock, one example app and the test runner |
| `packages.json` | The package repos the nightly run tests |

### The mock collector

It serves the tracker files at `/js/pa.js`, `/js/pa.clicks.js` and so on.
Like the real server, it fills in the tracker's `__PA_TRACKER_ORIGIN__`
placeholder with its own address, so the tracker sends hits back to it.

`POST /api/event` takes a hit the way the real endpoint does: a JSON object
of up to 32 KB, answered with `202` and no body. It turns the tracker's
short keys (`s`, `t`, `u`, `p` and so on) into their long names, notes
anything the real server would drop, and keeps every hit in memory.

| Route | What it does |
|---|---|
| `GET /__hits` | Every hit so far, oldest first, as JSON |
| `POST /__reset` | Forgets every hit |
| `GET /__health` | Answers `ok` |

Run it on its own with `node mock/server.mjs` (port 4000, or set `PORT`).

### Refresh the tracker

The tests use the copy in `tracker/`, so a run is the same until you
choose to change it. `tracker/PINNED.txt` lists a checksum for each file.
To copy the latest tracker from the web app:

```sh
scripts/refresh-tracker.sh /path/to/web/tracker/src
```

Then run `./run-all.sh` before you commit the new copy.

## Add a package

1. Add `example/` to the package, following [CONTRACT.md](CONTRACT.md).
2. Run `./run.sh ../<package>` until it passes.
3. Add the repo to `packages.json`, so the nightly run tests it. A package
   inside a monorepo is listed with its folder, for example
   `{ "repo": "js", "dir": "express" }`. Its Dockerfile can reach the rest of
   the repo through a `FROM ... AS workspace` stage: `run.sh` passes the folder
   above the package (or `WORKSPACE_DIR`) as that build context.

## Things to know

- The browser reaches the app at `http://example-app:8080`. Two names do not
  work: `localhost` (the tracker sends nothing from it) and `app` (Chromium
  always uses HTTPS for `.app` names).
- The tracker sends nothing from an automated browser. The tests hide the
  flag that says the browser is automated, as a person's browser would.
- The tests run one at a time. Each page gets its own `utm_content` value
  in its address, so a test only looks at its own hits.

## Nightly run

`.github/workflows/conformance.yml` runs every night and when started by
hand (Actions, Conformance, Run workflow; you can name one package). For
each repo in `packages.json` it checks out this repo and that one, runs
`./run.sh` and uploads the report.

## Links

- Docs: https://privatusanalytics.com/docs
- Script attributes: https://privatusanalytics.com/docs/tracker/attributes

## License

MIT. Copyright (c) 2026 Two Phase LLC. See [LICENSE](LICENSE).
