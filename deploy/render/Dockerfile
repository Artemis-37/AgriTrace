# Image pour Render : API + portail web (la base PostgreSQL est fournie par Render). Contexte de build : la racine du dépôt.
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

FROM node:22-bookworm-slim
# Pas de PORT ici : Render fournit le sien. Disque éphémère (offre gratuite) : les documents joints sont perdus à chaque redémarrage.
ENV NODE_ENV=production WEB_DIR=/app/web DOCUMENTS_DIR=/tmp/documents POSTGIS=off
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /w/dist ./web
COPY backend/package.json ./
COPY backend/migrations ./migrations
# seed-demo-complet.js : données FICTIVES, pour l'essai uniquement.
COPY backend/scripts/migrate.js backend/scripts/create-platform-admin.js backend/scripts/seed-demo-complet.js ./scripts/
COPY docs/brand/logo-cooperative-demo.png /docs/brand/logo-cooperative-demo.png
COPY deploy/render/prepare.js ./scripts/render-prepare.js
COPY deploy/render/state.js ./scripts/render-state.js
COPY deploy/render/start.sh /start.sh
RUN mkdir -p /tmp/documents && chmod +x /start.sh && chown -R node:node /app /tmp/documents
USER node
EXPOSE 10000
CMD ["/start.sh"]
