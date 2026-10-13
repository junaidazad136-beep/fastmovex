# FastMoveX website — production image (Next.js standalone output, non-root)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time settings (image optimiser allow-list). Runtime settings are passed with `docker run -e`.
ARG NEXT_PUBLIC_MEDIA_URL
ARG IMAGE_OPTIMIZATION=true
ENV NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL IMAGE_OPTIMIZATION=$IMAGE_OPTIMIZATION
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini && addgroup -S fastmovex && adduser -S fastmovex -G fastmovex
COPY --from=build --chown=fastmovex:fastmovex /app/.next/standalone ./
COPY --from=build --chown=fastmovex:fastmovex /app/.next/static ./.next/static
COPY --from=build --chown=fastmovex:fastmovex /app/public ./public
USER fastmovex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/robots.txt >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
