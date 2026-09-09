FROM node:22-alpine AS build
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY apps/gateway/ ./
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npm ci && npm run build

FROM node:22-alpine
WORKDIR /app
ARG MG_RELEASE_ID=unreleased
ARG MG_RELEASE_SHA256=unreleased
ENV NODE_ENV=production
ENV AUTO_CIRCUIT_BREAKER_ENABLED=false
ENV MG_RELEASE_ID=$MG_RELEASE_ID
ENV MG_RELEASE_SHA256=$MG_RELEASE_SHA256
ENV NODE_OPTIONS=--max-old-space-size=512
LABEL com.meta-gravity.token-one.release-id=$MG_RELEASE_ID
LABEL com.meta-gravity.token-one.artifact-sha256=$MG_RELEASE_SHA256
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY web-dist ./web-dist
COPY apps/gateway/scripts ./scripts
EXPOSE 3000
CMD ["node", "dist/main.js"]
