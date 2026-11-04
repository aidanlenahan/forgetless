#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
	# A host bind mount (./data:/data) is often created root-owned by Docker; make it writable for `node`.
	data_dir="$(dirname "${APP_DB_PATH:-/data/app.db}")"
	mkdir -p "$data_dir"
	if [ "$(stat -c %u "$data_dir")" != "$(id -u node)" ]; then
		chown -R node:node "$data_dir"
	fi
	exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
