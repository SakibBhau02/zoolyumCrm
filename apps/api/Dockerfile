# Production images for the two apps.
#
# The repo ships a compose file for local Postgres/Redis only; without these
# Dockerfiles a deploy required hand-built Node environments.
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @zoolyum/api --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build --prefix apps/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY apps/api/package.json ./package.json
# Uploads are local disk in this build; mount a volume here in production or
# switch the storage adapter before scaling horizontally.
RUN mkdir -p uploads && chown -R app:app /app
USER app
EXPOSE 4000
CMD ["node", "dist/main.js"]
