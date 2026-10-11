# syntax=docker/dockerfile:1.7
# FastMoveX API — production image.
#   docker build -t fastmovex-api .
#   docker run --env-file .env -p 4000:4000 jovia-api                         # the API
#   docker run --env-file .env jovia-api npx prisma migrate deploy            # release step: migrations
#   docker run --env-file .env jovia-api npm run db:seed                      # first deploy only: base config

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
# openssl: used by the Prisma migrate engine; tini: correct signal handling (graceful shutdown)
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 jovia && useradd --system --uid 1001 --gid jovia --home /app jovia
COPY --from=build --chown=jovia:jovia /app/node_modules ./node_modules
COPY --from=build --chown=jovia:jovia /app/dist ./dist
COPY --from=build --chown=jovia:jovia /app/prisma ./prisma
# fonts for PDFs (run sheets, cash receipts): Arabic + Latin
COPY --chown=jovia:jovia assets ./assets
COPY --chown=jovia:jovia package.json prisma.config.ts ./
USER jovia
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
