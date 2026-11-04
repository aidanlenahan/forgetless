#!/bin/sh
set -e

# SvelteKit 3 / adapter-node 6 have no runtime ORIGIN variable: the origin is baked in at build time from
# APP_ORIGIN (vite.config.ts). Auth and CSRF checks fail if the runtime APP_ORIGIN differs.
if [ -n "$APP_BUILD_ORIGIN" ] && [ "${APP_ORIGIN%/}" != "$APP_BUILD_ORIGIN" ]; then
	echo "WARNING: APP_ORIGIN=$APP_ORIGIN but this image was built for $APP_BUILD_ORIGIN." >&2
	echo "         Rebuild with the new origin: docker compose build (APP_ORIGIN in .env), or" >&2
	echo "         docker build --build-arg APP_ORIGIN=$APP_ORIGIN ." >&2
fi

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
