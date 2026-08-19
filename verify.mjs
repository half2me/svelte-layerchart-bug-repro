/**
 * Drives the four modes and reports which ones stop responding.
 * Usage: pnpm dev  (in another terminal), then: node verify.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5199';
const withTimeout = (p, ms) =>
	Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

async function run(mode, clicks = 5) {
	const browser = await chromium.launch({ args: ['--no-proxy-server'] });
	const page = await (await browser.newContext()).newPage();
	page.setDefaultTimeout(8000);
	const results = [];
	try {
		await page.goto(BASE, { timeout: 30000 });
		await page.getByRole('radio', { name: mode, exact: true }).check();
		await page.waitForTimeout(1500);
		for (let i = 0; i < clicks; i++) {
			const t0 = Date.now();
			try {
				await page.locator('#bump').click({ timeout: 8000 });
				await withTimeout(page.evaluate(() => 1), 8000);
				results.push(`${Date.now() - t0}ms`);
			} catch {
				results.push('FROZEN');
				break;
			}
			await page.waitForTimeout(250);
		}
	} catch (e) {
		results.push('setup failed: ' + String(e).split('\n')[0]);
	}
	console.log(mode.padEnd(8), results.join(' / '));
	await browser.close().catch(() => {});
}

for (const mode of (process.env.MODES ?? 'plain,beside,latched,inside').split(',')) await run(mode);
process.exit(0);
