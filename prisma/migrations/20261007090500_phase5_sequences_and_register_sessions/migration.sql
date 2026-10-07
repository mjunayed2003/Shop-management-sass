-- AlterEnum
ALTER TYPE "SequenceType" ADD VALUE 'DUE_COLLECTION';
ALTER TYPE "SequenceType" ADD VALUE 'SALES_RETURN';
ALTER TYPE "SequenceType" ADD VALUE 'EXCHANGE';
ALTER TYPE "SequenceType" ADD VALUE 'SUPPLIER_PAYMENT';
ALTER TYPE "SequenceType" ADD VALUE 'STOCK_ADJUSTMENT';
ALTER TYPE "SequenceType" ADD VALUE 'STOCKTAKE';
ALTER TYPE "SequenceType" ADD VALUE 'DAMAGE';
ALTER TYPE "SequenceType" ADD VALUE 'PURCHASE_ORDER';

-- AlterTable
ALTER TABLE "due_collections" ADD COLUMN "register_session_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "register_session_id" UUID;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN "register_session_id" UUID;

-- CreateIndex
CREATE INDEX "due_collections_register_session_id_idx" ON "due_collections"("register_session_id");

-- CreateIndex
CREATE INDEX "expenses_register_session_id_idx" ON "expenses"("register_session_id");

-- CreateIndex
CREATE INDEX "sales_returns_register_session_id_idx" ON "sales_returns"("register_session_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_collections" ADD CONSTRAINT "due_collections_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "register_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
