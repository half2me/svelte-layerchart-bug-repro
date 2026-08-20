#!/bin/bash
# Runs the `inside` mode (the shape that freezes) against both installs, at both svelte versions.
# Assumes: this repo on :5199 (kit 3), a sibling install at ../repro-kit2 on :5200 (kit 2.64).
set -u
run() { # dir port label
	cd "$1" || return
	kill $(ps -eo pid,args | grep -F "vite.js dev" | grep -v grep | grep "$1" | awk '{print $1}') 2>/dev/null
	sleep 2; rm -rf node_modules/.vite .svelte-kit/output
	(setsid nohup pnpm dev > /tmp/vm-$2.log 2>&1 < /dev/null &)
	for i in $(seq 1 40); do curl -sf --noproxy '*' "http://localhost:$2/" -o /dev/null && break; sleep 1; done
	echo "--- $3"
	echo -n "    kit=$(node -e "process.stdout.write(require('$1/node_modules/@sveltejs/kit/package.json').version)") "
	echo "svelte=$(node -e "process.stdout.write(require('$1/node_modules/svelte/package.json').version)")"
	(cd /home/user/repro-kit-chart-freeze && BASE="http://localhost:$2" MODES=plain,inside node verify.mjs)
}
setver() { cd "$1" && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.devDependencies.svelte='$2';fs.writeFileSync('package.json',JSON.stringify(p,null,'\t')+'\n')" && pnpm install >/dev/null 2>&1 && node instrument/patch-svelte.mjs >/dev/null 2>&1; }
for SV in 5.56.9 5.56.7; do
	setver /home/user/repro-kit-chart-freeze "$SV"; run /home/user/repro-kit-chart-freeze 5199 "SvelteKit 3.0.0-next.23, svelte $SV"
	setver /home/user/repro-kit2 "$SV";           run /home/user/repro-kit2 5200 "SvelteKit 2.64.0, svelte $SV"
done
