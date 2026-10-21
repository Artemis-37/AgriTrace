# syntaxe : docker/dockerfile:1
FROM node:25-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json* ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:25-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY scripts/migrate.js scripts/create-platform-admin.js ./scripts/
RUN mkdir -p /data/documents && chown -R node:node /data /app
USER node
ENV DOCUMENTS_DIR=/data/documents PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/main"]
