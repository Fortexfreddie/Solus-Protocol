# Build Stage
FROM node:20-alpine

# Install OpenSSL and libc6-compat (Required by Prisma on Alpine Linux)
RUN apk add --no-cache openssl libc6-compat

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy dependency files first
COPY package.json pnpm-lock.yaml ./

# NEW: Copy the prisma folder BEFORE installing 
# This ensures the 'postinstall' prisma generate script finds the schema
COPY prisma ./prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application source
COPY . .

# Build TypeScript
RUN pnpm build

# Expose backend port
EXPOSE 3001

# Start the application
CMD ["pnpm", "start"]