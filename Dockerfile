# Image « tout-en-un » pour l'essai sur Fly.io : PostgreSQL 16 + PostGIS, API et portail web dans une même machine (données sur le volume /data).
FROM node:22-bookworm-slim AS web
WORKDIR /w
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig*.json backend/nest-cli.json* ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM postgis/postgis:16-3.4
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web DOCUMENTS_DIR=/data/documents
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /w/dist ./web
COPY backend/package.json ./
COPY backend/migrations ./migrations
# seed-demo-complet.js : données FICTIVES, pour l'essai uniquement.
COPY backend/scripts/migrate.js backend/scripts/create-platform-admin.js backend/scripts/seed-demo-complet.js backend/scripts/seed-demo-enrichi.js backend/scripts/seed-demo-supplement.js backend/scripts/seed-demo-chaine.js backend/scripts/seed-demo-activite.js backend/scripts/seed-demo-modules.js ./scripts/
COPY docs/brand/logo-cooperative-demo.png /docs/brand/logo-cooperative-demo.png
COPY deploy/fly/start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 3000
ENTRYPOINT []
CMD ["/start.sh"]
