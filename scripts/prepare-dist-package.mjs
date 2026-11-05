// Rewrites package.json for the `dist` branch (prebuilt lib/ for direct
// git/tarball consumers). Run only on the dist checkout, after `yarn build`:
// the patched branch keeps the full dev manifest.
//
// - drops prepare/prepack so installs never trigger a local build
// - prunes devDependencies so installers don't stage the toolchain
// - marks the fork build in the version so it can't be confused with upstream
// name, main, types and the preinstall engine check are left untouched.
import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../package.json', import.meta.url)
const raw = readFileSync(path, 'utf8')
const indent = raw.includes('\n\t"') ? '\t' : 2
const pkg = JSON.parse(raw)

delete pkg.scripts?.prepare
delete pkg.scripts?.prepack
delete pkg.devDependencies

if (!pkg.version.includes('-patched')) {
	pkg.version = `${pkg.version}-patched.1`
}

writeFileSync(path, JSON.stringify(pkg, null, indent) + '\n')
console.log(`dist package.json: version=${pkg.version}, prepare/prepack removed, devDependencies pruned`)
