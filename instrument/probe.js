// Installed into the page before any app code. Counts derived recomputations and is_dirty
// walks, and streams a line every 250k so the numbers keep arriving after the tab wedges.
(() => {
	const LOG_EVERY = 250_000;
	const DUMP_AT = 1_000_000;
	const p = {
		updates: 0,
		dirty: 0,
		next: LOG_EVERY,
		dumped: false,
		fns: new Set(),
		tick(d) {
			p.updates++;
			const f = d && d.fn;
			if (f) {
				if (f.__probeN === undefined) {
					f.__probeN = 0;
					p.fns.add(f);
				}
				f.__probeN++;
			}
			if (p.updates >= p.next) {
				p.next += LOG_EVERY;
				console.warn(
					`[probe] update_derived=${p.updates} is_dirty=${p.dirty} t=${Math.round(performance.now())}ms`
				);
				if (p.updates >= DUMP_AT && !p.dumped) {
					p.dumped = true;
					p.dump();
				}
			}
		},
		dump() {
			const top = [...p.fns].sort((a, b) => b.__probeN - a.__probeN).slice(0, 12);
			console.warn('[probe:top] recomputations  derived');
			for (const f of top) {
				const src = f.toString().replace(/\s+/g, ' ').slice(0, 100);
				console.warn(`[probe:top] ${String(f.__probeN).padStart(9)}  ${src}`);
			}
			try {
				throw new Error('sample');
			} catch (e) {
				console.warn('[probe:stack]' + e.stack.split('\n').slice(1, 20).join('\n'));
			}
		},
		reset() {
			p.updates = 0;
			p.dirty = 0;
			p.next = LOG_EVERY;
			p.dumped = false;
			for (const f of p.fns) f.__probeN = 0;
		}
	};
	globalThis.__svelteProbe = p;
})();
