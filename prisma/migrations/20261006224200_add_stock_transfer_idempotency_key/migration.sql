-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_business_id_idempotency_key_key" ON "stock_transfers"("business_id", "idempotency_key");
