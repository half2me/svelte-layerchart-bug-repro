/**
 * Adds two counters to Svelte's client runtime, in node_modules, so a wedged tab can say
 * how much work it is doing. Vite serves Svelte from source in dev, so patching src is enough.
 *
 *   node instrument/patch-svelte.mjs            # apply
 *   node instrument/patch-svelte.mjs --revert   # restore
 *
 * The counters are no-ops unless globalThis.__svelteProbe exists (instrument/probe.js installs it).
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';

const PROBE = 'var __p = globalThis.__svelteProbe;';
const targets = [
	{
		file: 'node_modules/svelte/src/internal/client/reactivity/deriveds.js',
		anchor: 'export function update_derived(derived) {',
		inject: `\n\t${PROBE} if (__p !== undefined) __p.tick(derived);`
	},
	{
		file: 'node_modules/svelte/src/internal/client/runtime.js',
		anchor: 'export function is_dirty(reaction) {',
		inject: `\n\t${PROBE} if (__p !== undefined) __p.dirty++;`
	}
];

const revert = process.argv.includes('--revert');

for (const { file, anchor, inject } of targets) {
	const backup = file + '.probe-backup';
	if (revert) {
		if (existsSync(backup)) {
			copyFileSync(backup, file);
			console.log('reverted', file);
		}
		continue;
	}
	if (!existsSync(backup)) copyFileSync(file, backup);
	const src = readFileSync(backup, 'utf8');
	if (!src.includes(anchor)) throw new Error(`anchor not found in ${file}: ${anchor}`);
	writeFileSync(file, src.replace(anchor, anchor + inject));
	console.log('patched', file);
}
