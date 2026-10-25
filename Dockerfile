# Image unique pour Fly.io : API + portail web servi par l'API (WEB_DIR). Contexte de build : la racine du dépôt.
FROM node:22-slim AS web
WORKDIR /w
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig*.json backend/nest-cli.json* ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web DOCUMENTS_DIR=/data/documents
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /w/dist ./web
COPY backend/package.json ./
COPY backend/migrations ./migrations
# seed-demo-complet.js : données FICTIVES, pour l'essai uniquement (à retirer d'une vraie mise en production).
COPY backend/scripts/migrate.js backend/scripts/create-platform-admin.js backend/scripts/seed-demo-complet.js ./scripts/
RUN mkdir -p /data/documents && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node","dist/main"]
