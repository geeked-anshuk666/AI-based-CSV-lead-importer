# Node.js optimized multi-stage build
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runner stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/.next/standalone ./.next/standalone
COPY --from=builder /usr/src/app/.next/static ./.next/static
COPY --from=builder /usr/src/app/package.json ./package.json

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", ".next/standalone/server.js"]
