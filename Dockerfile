# Forgetless: one image, SQLite on a mounted volume (/data).

# ---- build -------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain for native modules (better-sqlite3) in case no prebuilt binary matches.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build \
	&& npm prune --omit=dev

# ---- runtime -----------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	PORT=3000 \
	APP_ORIGIN=http://localhost:3000 \
	APP_DB_PATH=/data/app.db \
	APP_MIGRATIONS_DIR=/app/drizzle \
	BODY_SIZE_LIMIT=21M

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# Entry point that applies the runtime APP_ORIGIN (see server.js).
COPY --from=build --chown=node:node /app/server.js ./server.js
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

# The entrypoint fixes ownership of a bind-mounted /data if needed, then runs the app as the
# unprivileged `node` user. APP_ORIGIN is read at runtime by server.js.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
