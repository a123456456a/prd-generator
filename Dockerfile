# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@prd/api", "start"]
