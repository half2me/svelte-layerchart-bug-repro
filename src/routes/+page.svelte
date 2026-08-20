<script lang="ts">
	import { BarChart } from 'layerchart';
	import { getRows } from './data.remote';

	/**
	 * Four shapes, selected with ?mode=. Only the last two freeze.
	 *
	 *   plain    — chart fed from a PLAIN awaited promise. No remote function. Fine.
	 *   beside   — chart fed from local state, with an awaited remote query BESIDE it that
	 *              re-resolves on every click. Fine.
	 *   latched  — chart fed from the remote query's value via an $effect latch, awaited region
	 *              present. FREEZES on the second click.
	 *   inside   — chart INSIDE the awaited region, fed by the awaited value. FREEZES on the
	 *              second click.
	 */
	const modes = ['plain', 'beside', 'latched', 'inside'] as const;
	type Mode = (typeof modes)[number];

	let mode = $state<Mode>('inside');
	let bucket = $state(0);

	const series = [{ key: 'value', label: 'V', color: '#0a0' }];

	/** Local data, so a chart can be updated without a remote query being involved. */
	const localRows = $derived(
		Array.from({ length: 10 + bucket }, (_, i) => ({
			date: new Date(2026, 0, 1 + i),
			value: 100 + ((i * (bucket + 1)) % 50)
		}))
	);

	/**
	 * The same data as the remote query returns, but through an ordinary promise.
	 * localRows is read SYNCHRONOUSLY here on purpose: read it inside the setTimeout callback
	 * instead and this derived has no reactive dependency, so the chart never updates and the
	 * mode silently stops being a control.
	 */
	const plainPromise = $derived.by(() => {
		const rows = localRows;
		return new Promise<typeof localRows>((resolve) => setTimeout(() => resolve(rows), 40));
	});

	const rowsQuery = $derived(getRows({ bucket }));
	let latched = $state<typeof localRows | null>(null);
	$effect(() => {
		if (mode !== 'latched') return;
		const current = rowsQuery.current;
		if (current) latched = current as typeof localRows;
	});
</script>

<h1>SvelteKit remote query + layerchart freeze</h1>

<p>
	{#each modes as m (m)}
		<label>
			<input type="radio" value={m} bind:group={mode} />
			{m}
		</label>
	{/each}
</p>

<p>
	<button id="bump" onclick={() => (bucket += 1)}>bump ({bucket})</button>
	<span id="alive">page is responding</span>
</p>

<div id="chart" style="height: 240px; max-width: 720px">
	{#if mode === 'plain'}
		<svelte:boundary>
			{#snippet pending()}<p>loading…</p>{/snippet}
			{@const rows = await plainPromise}
			<BarChart data={rows} x="date" {series} seriesLayout="stack" axis grid rule />
		</svelte:boundary>
	{:else if mode === 'beside'}
		<svelte:boundary>
			{#snippet pending()}<p>loading…</p>{/snippet}
			{@const rows = await getRows({ bucket })}
			<p id="count">{rows.length} rows from the query</p>
		</svelte:boundary>
		<BarChart data={localRows} x="date" {series} seriesLayout="stack" axis grid rule />
	{:else if mode === 'latched'}
		<svelte:boundary>
			{#snippet pending()}<p>loading…</p>{/snippet}
			{@const rows = await getRows({ bucket })}
			<p id="count">{rows.length} rows from the query</p>
		</svelte:boundary>
		{#if latched}
			<BarChart data={latched} x="date" {series} seriesLayout="stack" axis grid rule />
		{/if}
	{:else}
		<svelte:boundary>
			{#snippet pending()}<p>loading…</p>{/snippet}
			{@const rows = await getRows({ bucket })}
			<BarChart data={rows} x="date" {series} seriesLayout="stack" axis grid rule />
		</svelte:boundary>
	{/if}
</div>
