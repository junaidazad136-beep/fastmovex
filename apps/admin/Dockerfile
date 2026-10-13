# FastMoveX admin panel — production image (Next.js standalone output, non-root)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# All settings (PUBLIC_API_URL, STOREFRONT_URL, MEDIA_URL, DEFAULT_COUNTRY) are read at runtime: pass them with `docker run -e`.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini && addgroup -S fastmovex && adduser -S fastmovex -G fastmovex
COPY --from=build --chown=fastmovex:fastmovex /app/.next/standalone ./
COPY --from=build --chown=fastmovex:fastmovex /app/.next/static ./.next/static
COPY --from=build --chown=fastmovex:fastmovex /app/public ./public
USER fastmovex
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/robots.txt >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
