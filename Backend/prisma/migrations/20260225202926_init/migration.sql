-- CreateTable
CREATE TABLE "AgentWallet" (
    "id" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRecord" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "memoSignature" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "anchoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_agentId_idx" ON "AuditLog"("agentId");

-- CreateIndex
CREATE INDEX "AuditLog_event_idx" ON "AuditLog"("event");

-- CreateIndex
CREATE UNIQUE INDEX "ProofRecord_hash_key" ON "ProofRecord"("hash");

-- CreateIndex
CREATE INDEX "ProofRecord_agentId_idx" ON "ProofRecord"("agentId");
