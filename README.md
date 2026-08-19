# SvelteKit 3 + `layerchart`: the tab freezes on the second update

A chart whose **data comes from a remote query that the page also `await`s** locks the browser's
main thread from the **second** update onward. The first update is fine. There is no error, no
`failed` boundary and no recovery short of a reload.

Reduced from a real dashboard, where the symptom was "changing the stats period twice hangs the
tab". It survived every containment we tried, so the app now cannot `await` that query at all.

## Reproduce

```bash
pnpm install
pnpm dev          # http://localhost:5199
```

Open the page, choose a mode with the radio buttons, then press **bump** a few times.

- `plain` / `beside` — keep responding, however many times you press.
- `latched` / `inside` — the **second** press wedges the tab. The button stops responding, the
  page stops repainting, and the CPU stays pinned.

Or drive all four automatically (needs `playwright` installed):

```bash
node verify.mjs
```

```
plain    31ms / 31ms / 30ms / 31ms / 35ms
beside   95ms / 85ms / 87ms / 78ms / 85ms
latched  43ms / FROZEN
inside   39ms / FROZEN
```

## What each mode isolates

All four render the same `layerchart` `BarChart` with the same data, updated the same number of
times. Only the **source** of that data differs.

| Mode      | Chart data comes from                                   | Awaited region on the page | Result |
| --------- | ------------------------------------------------------- | -------------------------- | ------ |
| `plain`   | a plain `Promise`, awaited in the boundary               | yes (the promise)          | fine   |
| `beside`  | local `$state`                                          | yes (a remote query)       | fine   |
| `latched` | the remote query's value, via an `$effect` latch         | yes (the same query)       | FREEZE |
| `inside`  | the remote query's value, awaited in the boundary        | yes (the same query)       | FREEZE |

So it is **not** "an `await` on the page": `beside` awaits a remote query that re-resolves on every
press, next to a chart being updated every press, and is perfectly happy. And it is **not** "an
awaited promise feeding a chart": `plain` does exactly that and is happy too.

It takes all three together:

1. a chart with a deep reactive graph (`layerchart`),
2. a remote query the page `await`s, and
3. the chart's data being **downstream of that query**.

## Things that do NOT help

Tried against the original application, all still freeze:

- moving the chart out of the boundary into a sibling branch of the page
- feeding it from `$state` latched in an `$effect`, so its update lands after the batch
- remounting it with `{#key}` instead of updating it
- `renderContext="canvas"`, so the marks are one canvas draw instead of a component per bar
- extracting the awaiting markup into a child component
- unwrapping the query into a plain promise first —
  `getRows(args).then((r) => $state.snapshot(r))` — which is what makes us think the cause is the
  query's own reactive machinery rather than the value it hands on
- `layerchart@2.2.0` instead of `2.0.2` (better, still freezes)
- `svelte@5.56.7` instead of `5.56.9` (unchanged)

The only thing that fixes it is not `await`ing that query on that page: read it through `.current`,
latch it, and render from the latch — which costs the page its server-rendered content.

## Where the time goes

Pausing the debugger while wedged lands, every time, inside `layerchart`'s own chart-context
deriveds — `dimensions` ← `scaleDimensions` ← `insets` ← `extractLayerProps` — re-entering
themselves, with Svelte's `is_dirty` the hottest frame in the profile. The application's own
deriveds each recompute a handful of times while the tab is stuck, so nothing in user code is
looping.

We could not reduce it below `layerchart`. A synthetic component with a comparably deep derived DAG
(depth 12, fan-in 3, every node returning a fresh object, 90 leaf consumers), with and without an
`$effect` measurement cycle, does not reproduce it in any mode.

## Versions

- `@sveltejs/kit` 3.0.0-next.23
- `svelte` 5.56.9 (`compilerOptions.experimental.async`, `experimental.remoteFunctions`)
- `layerchart` 2.0.2
- `vite` 8.2.1, Node 22, Chromium

Both experimental flags are required — see `vite.config.ts`.
