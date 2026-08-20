/**
 * Same four modes as verify.mjs, but reports HOW MUCH reactive work each click causes.
 *
 *   node instrument/patch-svelte.mjs
 *   pnpm dev            # in another terminal
 *   node instrument.mjs
 *   node instrument/patch-svelte.mjs --revert
 *
 * Counters are reset before each click, so each line is the cost of that one click.
 * A wedged tab can no longer answer page.evaluate(), so the numbers for it come from the
 * console lines the probe streams every 250k recomputations.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5199';
const CLICKS = Number(process.env.CLICKS ?? 3);
const WEDGE_WATCH_MS = Number(process.env.WEDGE_WATCH_MS ?? 20_000);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 800);
const probe = readFileSync(new URL('./instrument/probe.js', import.meta.url), 'utf8');

const withTimeout = (p, ms) =>
	Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mode) {
	const browser = await chromium.launch({ args: ['--no-proxy-server'] });
	const page = await (await browser.newContext()).newPage();
	page.setDefaultTimeout(8000);
	const probeLines = [];
	page.on('console', (msg) => {
		const t = msg.text();
		if (t.startsWith('[probe')) probeLines.push(t);
	});

	console.log(`\n=== mode: ${mode} ===`);
	try {
		await page.addInitScript(probe);
		await page.goto(BASE, { timeout: 30_000 });
		await page.getByRole('radio', { name: mode, exact: true }).check();
		// wait for the chart to actually mount, or its mount cost lands on click 1
		await page.locator('#chart rect').first().waitFor({ timeout: 10_000 });
		await sleep(1000);
		const load = await page.evaluate(() => ({
			u: globalThis.__svelteProbe.updates,
			d: globalThis.__svelteProbe.dirty
		}));
		console.log(`  page load          update_derived=${load.u}  is_dirty=${load.d}`);

		for (let i = 1; i <= CLICKS; i++) {
			await page.evaluate(() => globalThis.__svelteProbe.reset());
			probeLines.length = 0;
			const t0 = Date.now();
			try {
				await page.locator('#bump').click({ timeout: 5000 });
				await withTimeout(page.evaluate(() => 1), 5000);
				const responded = Date.now() - t0;
				// let the update settle before reading the counters, so a chart that redraws
				// after its promise resolves is included
				await sleep(SETTLE_MS);
				const c = await withTimeout(
					page.evaluate(() => ({
						u: globalThis.__svelteProbe.updates,
						d: globalThis.__svelteProbe.dirty,
						bars: document.querySelectorAll('#chart rect').length
					})),
					5000
				);
				console.log(
					`  click ${i}  responded in ${String(responded).padStart(5)}ms  update_derived=${String(c.u).padStart(8)}  is_dirty=${String(c.d).padStart(9)}  bars=${c.bars}`
				);
			} catch {
				console.log(`  click ${i}  WEDGED. Tab stopped answering, watching the probe stream.`);
				const t1 = Date.now();
				while (Date.now() - t1 < WEDGE_WATCH_MS) await sleep(500);
				for (const line of probeLines) console.log('    ' + line.replace(/\n/g, '\n    '));
				if (!probeLines.length) console.log('    (no probe output reached the driver)');
				console.log(`    still wedged after ${Math.round((Date.now() - t1) / 1000)}s`);
				break;
			}
			await sleep(400);
		}
	} catch (e) {
		console.log('  setup failed:', String(e).split('\n')[0]);
	}
	await browser.close().catch(() => {});
}

for (const mode of (process.env.MODES ?? 'plain,beside,latched,inside').split(',')) await run(mode);
process.exit(0);
