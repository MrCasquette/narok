FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 8100
CMD ["bun", "run", "dist/index.js"]
