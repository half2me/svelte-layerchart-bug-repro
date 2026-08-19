import { query } from '$app/server';
import * as v from 'valibot';

export interface Row {
	date: Date;
	value: number;
}

/**
 * A remote query whose ARGUMENT changes when the page's selector changes, so each selection is a
 * distinct query instance — exactly how a dashboard's period selector works.
 */
export const getRows = query(v.object({ bucket: v.number() }), async ({ bucket }): Promise<Row[]> => {
	return Array.from({ length: 10 + bucket }, (_, i) => ({
		date: new Date(2026, 0, 1 + i),
		value: 100 + ((i * (bucket + 1)) % 50)
	}));
});
