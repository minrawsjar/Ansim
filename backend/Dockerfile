# Backend image. Build context is the repository root: docker build -f backend/Dockerfile .
FROM node:22-bookworm-slim

# better-sqlite3 downloads a prebuilt binary; these tools are the fallback if it has to compile.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY contracts/package.json contracts/
RUN npm ci --workspace backend --include=dev --no-audit --no-fund

COPY backend backend
COPY contracts contracts

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "src/server.ts"]
