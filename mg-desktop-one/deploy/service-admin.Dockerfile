FROM node:24.20.0-bookworm-slim
WORKDIR /app
COPY desktop/service-storage-admin.mjs ./service-storage-admin.mjs
USER node
ENTRYPOINT ["node", "/app/service-storage-admin.mjs"]
