#!/bin/sh
# Paths below are relative to this directory; `yarn gen:protobuf` runs the
# script from the repository root, so move here first. Stop at the first
# failing step so a bad WAProto.proto cannot leave a truncated index.d.ts
# behind while the script still exits 0. The previously generated files are
# backed up first and restored on failure, so a failed run never leaves a
# half-regenerated WAProto (new index.js beside a stale index.d.ts).
set -eu
cd "$(dirname "$0")"

backup="$(mktemp -d)"
cp ./index.js ./index.d.ts "$backup/"

cleanup() {
	status=$?
	rm -f ./index.commented.tmp.js
	if [ "$status" -ne 0 ]; then
		cp "$backup/index.js" ./index.js
		cp "$backup/index.d.ts" ./index.d.ts
		echo "WAProto generation failed; restored previous index.js and index.d.ts." >&2
	fi
	rm -rf "$backup"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

yarn pbjs -t static-module --no-beautify -w es6 --no-bundle --no-delimited --no-verify --no-comments -o ./index.js ./WAProto.proto
yarn pbjs -t static-module --no-beautify -w es6 --no-bundle --no-delimited --no-verify -o ./index.commented.tmp.js ./WAProto.proto
yarn pbts --no-comments -o ./index.d.ts ./index.commented.tmp.js
node ./fix-imports.js
