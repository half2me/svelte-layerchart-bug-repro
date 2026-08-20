import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// The README, verify.mjs and instrument.mjs all assume this port.
	server: { port: 5199, strictPort: true },
	plugins: [
		sveltekit({
			// Both flags are required to reproduce.
			compilerOptions: { experimental: { async: true } },
			experimental: { remoteFunctions: true },
			adapter: adapter()
		})
	]
});
