# Forgetless: one image, SQLite on a mounted volume (/data).

# ---- build -------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
# Public URL of the app. SvelteKit 3 / adapter-node 6 bake it in at build time (kit `paths.origin`, see
# vite.config.ts); it must match the runtime APP_ORIGIN. docker-compose.yml passes it from .env.
ARG APP_ORIGIN=http://localhost:3000
WORKDIR /app
# Toolchain for native modules (better-sqlite3) in case no prebuilt binary matches.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN APP_ORIGIN="$APP_ORIGIN" npm run build \
	&& npm prune --omit=dev

# ---- runtime -----------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ARG APP_ORIGIN=http://localhost:3000
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	APP_ORIGIN=$APP_ORIGIN \
	APP_BUILD_ORIGIN=$APP_ORIGIN \
	APP_DB_PATH=/data/app.db \
	APP_MIGRATIONS_DIR=/app/drizzle \
	BODY_SIZE_LIMIT=21M

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# SQL migrations, run automatically at startup (src/lib/server/db/index.ts).
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Admin CLI (`npm run admin -- ...`) runs under Node type stripping and imports a few server modules.
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src/lib/server ./src/lib/server
COPY --from=build --chown=node:node /app/src/lib/shared ./src/lib/shared
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip CRLF in case the repo was checked out on Windows with core.autocrlf (breaks the #! line).
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# The entrypoint fixes ownership of a bind-mounted /data if needed, warns if APP_ORIGIN differs from the
# build-time origin, then runs the app as the unprivileged `node` user.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "build"]
