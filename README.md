# SvelteKit 3 + `layerchart`: the tab freezes when an awaited remote query updates a chart

A chart whose **data comes from a remote query that the page also `await`s** locks the browser's
main thread. There is no error, no `failed` boundary and no recovery short of a reload — the tab
never converges, it just keeps recomputing.

**It is a SvelteKit 3 regression.** The same page, same `layerchart`, same `svelte`, same `vite`
is perfectly happy on `@sveltejs/kit` 2.64.0 — see [the version matrix](#is-it-sveltekit-or-svelte)
below.

Reduced from a real dashboard, where the symptom was "change the stats period and the tab hangs".
It survived every containment we tried, so that app cannot `await` that query at all.

## Reproduce

```bash
pnpm install
pnpm dev          # http://localhost:5199
```

Pick a mode with the radio buttons, then press **bump** a few times.

- `plain` / `beside` — the chart redraws and the page keeps responding, however many times you press.
- `latched` / `inside` — the chart does **not** redraw, and within a press or two the tab wedges:
  the button stops responding, the page stops repainting, and a core stays pinned.

Or drive all four automatically (needs `playwright` installed):

```bash
node verify.mjs
```

```
plain    26ms/11bars / 26ms/12bars / 28ms/13bars / 30ms/14bars / 31ms/15bars
beside   108ms/11bars / 82ms/12bars / 91ms/13bars / 89ms/14bars / 112ms/15bars
latched  FROZEN
inside   FROZEN
```

The bar count matters as much as the time: the data is `10 + clicks` rows, so `11bars`, `12bars`, …
is how you know the chart really redrew rather than the mode quietly doing nothing. In the failing
modes a press that does **not** wedge leaves the chart at `10bars` — the update never lands, and
the next press wedges. Full output in [`logs/verify.txt`](logs/verify.txt).

## What each mode isolates

All four render the same `layerchart` `BarChart` with the same data, updated the same number of
times. Only the **source** of that data differs.

| Mode      | Chart data comes from                             | Awaited region on the page | Result |
| --------- | ------------------------------------------------- | -------------------------- | ------ |
| `plain`   | a plain `Promise`, awaited in the boundary         | yes (the promise)          | fine   |
| `beside`  | local `$state`                                     | yes (a remote query)       | fine   |
| `latched` | the remote query's value, via an `$effect` latch   | yes (the same query)       | FREEZE |
| `inside`  | the remote query's value, awaited in the boundary  | yes (the same query)       | FREEZE |

So it is **not** "an `await` on the page": `beside` awaits a remote query that re-resolves on every
press, next to a chart being updated every press, and is fine. And it is **not** "an awaited promise
feeding a chart": `plain` does exactly that, redraws every press, and is fine.

It takes all three together:

1. a chart with a deep reactive graph (`layerchart`),
2. a remote query the page `await`s, and
3. the chart's data being **downstream of that query**.

## Is it SvelteKit or Svelte?

SvelteKit. `inside` is the mode that freezes; `plain` is the control, and the pair moves only with
the Kit version ([`logs/version-matrix.txt`](logs/version-matrix.txt), produced by
[`logs/version-matrix.sh`](logs/version-matrix.sh)):

| | `svelte` 5.56.7 | `svelte` 5.56.9 |
| --- | --- | --- |
| **`@sveltejs/kit` 2.64.0** | `inside` fine, ~30ms/press | `inside` fine, ~30ms/press |
| **`@sveltejs/kit` 3.0.0-next.23** | `inside` **FROZEN** | `inside` **FROZEN** |

One caveat on that table: under Kit 2 the `latched` mode renders no chart at all (`0bars` — the
`$effect` latch never populates), so `inside` is the only like-for-like cell across the rows. It is
also the shape the real application used.

## How much work is it doing

`node instrument.mjs` counts recomputations inside Svelte's client runtime — see
[`instrument/patch-svelte.mjs`](instrument/patch-svelte.mjs), which adds two counters to
`update_derived` and `is_dirty` in `node_modules` (Vite serves Svelte from source in dev). Counters
are reset before each click, so each line is the cost of that one press:

```
=== mode: plain ===
  click 1  responded in    20ms  update_derived=    1170  is_dirty=    95968  bars=11
  click 2  responded in    26ms  update_derived=    1041  is_dirty=    95513  bars=12

=== mode: inside ===
  click 1  WEDGED — tab stopped answering; watching the probe stream…
    [probe] update_derived=250000  is_dirty=1834196  t=4725ms
    [probe] update_derived=1000000 is_dirty=6991365  t=10093ms
    [probe] update_derived=2000000 is_dirty=13787272 t=16386ms
    [probe] update_derived=4500000 is_dirty=30774685 t=32043ms
    still wedged after 25s
```

~1,100 derived recomputations for a press that works, versus **4.5 million and climbing** for one
that doesn't, with no sign of converging. Full output, including the top recomputing deriveds and a
stack sample, in [`logs/instrument.txt`](logs/instrument.txt):

```
[probe:top] recomputations  derived
[probe:top]    687650  () => this._getStackConfig()
[probe:top]    137026  () => { const config = get(this.#stackConfig); if (!config || !config.layout…
[probe:top]     17593  () => extractLayerProps(restProps, "lc-bars-bar")
[probe:stack]
    at update_derived (…/runtime.js)
    at get (…/runtime.js)
    at …/layerchart.js:3551
    at update_reaction (…/runtime.js)
    at execute_derived (…/runtime.js)
    at update_derived (…/runtime.js)
    at get (…/runtime.js)
    at SeriesState.getStackValue (…/layerchart.js:3613)
```

Everything hot is `layerchart`'s own chart-context deriveds re-entering themselves, with Svelte's
`is_dirty` walk on top. Nothing in application code is looping.

```bash
node instrument/patch-svelte.mjs          # apply the counters
pnpm dev                                  # in another terminal
node instrument.mjs
node instrument/patch-svelte.mjs --revert # put node_modules back
```

## Things that do NOT help

Tried against the original application, all still freeze:

- moving the chart out of the boundary into a sibling branch of the page
- feeding it from `$state` latched in an `$effect`, so its update lands after the batch (`latched`)
- remounting it with `{#key}` instead of updating it
- `renderContext="canvas"`, so the marks are one canvas draw instead of a component per bar
- extracting the awaiting markup into a child component
- unwrapping the query into a plain promise first —
  `getRows(args).then((r) => $state.snapshot(r))` — which is what makes us think the cause is the
  query's own reactive machinery rather than the value it hands on
- `layerchart@2.2.0` instead of `2.0.2` (better, still freezes)

The only thing that fixes it is not `await`ing that query on that page: read it through `.current`,
latch it, and render from the latch — which costs the page its server-rendered content.

## What we could not reduce

We could not get below `layerchart`. A synthetic component with a comparably deep derived DAG
(depth 12, fan-in 3, every node returning a fresh object, 90 leaf consumers), with and without an
`$effect` measurement cycle, does not reproduce it in any mode.

One thing to be careful of when reducing this further: a control mode is only a control if the
chart actually redraws. `$derived(new Promise((r) => setTimeout(() => r(localRows), 40)))` reads
`localRows` inside the callback, so the derived has no reactive dependency and the chart never
updates — the mode then "passes" while testing nothing. That is why `plain` reads its data
synchronously and why every check here asserts on the bar count.

## Related

- [`techniq/layerchart#895`](https://github.com/techniq/layerchart/issues/895) — same symptom, reported against layerchart
- [`sveltejs/svelte#18624`](https://github.com/sveltejs/svelte/issues/18624) — layerchart's maintainer escalating it to Svelte
- [`sveltejs/svelte#18503`](https://github.com/sveltejs/svelte/issues/18503) — `$derived` losing memoization while another batch is pending
- [`sveltejs/svelte#18558`](https://github.com/sveltejs/svelte/pull/18558) — "entangle batches", open, lists #18624 among what it fixes

## Versions

- `@sveltejs/kit` 3.0.0-next.23 (fine on 2.64.0)
- `svelte` 5.56.9 (`compilerOptions.experimental.async`, `experimental.remoteFunctions`)
- `layerchart` 2.0.2
- `vite` 8.2.1, Node 22, Chromium

Both experimental flags are required — see `vite.config.ts`.
