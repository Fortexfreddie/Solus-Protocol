# --- Builder Stage ---
FROM node:20-alpine AS builder

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build Next.js application
COPY . .
RUN pnpm build

# --- Runner Stage ---
# Minimal footprint production image
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built assets and required files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

# Expose Next.js port
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start"]
