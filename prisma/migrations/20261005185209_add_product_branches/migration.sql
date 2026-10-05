-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED', 'LOST', 'IN_TRANSIT');

-- CreateEnum
CREATE TYPE "BarcodePrintType" AS ENUM ('INITIAL_PRINT', 'REPRINT');

-- DropForeignKey
ALTER TABLE "due_collections" DROP CONSTRAINT "due_collections_payment_account_id_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_payment_account_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_payment_account_id_fkey";

-- DropForeignKey
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_payment_account_id_fkey";

-- AlterTable
ALTER TABLE "due_collections" ALTER COLUMN "payment_account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ALTER COLUMN "payment_account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "track_individually" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "product_unit_id" UUID;

-- AlterTable
ALTER TABLE "sale_payments" ALTER COLUMN "payment_account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "supplier_payments" ALTER COLUMN "payment_account_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "product_branches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_variant_id" UUID NOT NULL,
    "barcode_value" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "purchase_id" UUID,
    "sold_sale_id" UUID,
    "sold_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barcode_print_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_unit_id" UUID,
    "product_variant_id" UUID,
    "barcode_value" TEXT NOT NULL,
    "print_type" "BarcodePrintType" NOT NULL DEFAULT 'INITIAL_PRINT',
    "reason" TEXT,
    "printed_by" UUID NOT NULL,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label_format" TEXT NOT NULL DEFAULT 'CODE_128',
    "quantity_printed" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "barcode_print_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_branches_business_id_branch_id_is_active_idx" ON "product_branches"("business_id", "branch_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_branches_product_id_branch_id_key" ON "product_branches"("product_id", "branch_id");

-- CreateIndex
CREATE INDEX "product_units_business_id_branch_id_status_idx" ON "product_units"("business_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "product_units_product_variant_id_status_idx" ON "product_units"("product_variant_id", "status");

-- CreateIndex
CREATE INDEX "product_units_sold_sale_id_idx" ON "product_units"("sold_sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_business_id_barcode_value_key" ON "product_units"("business_id", "barcode_value");

-- CreateIndex
CREATE INDEX "barcode_print_logs_business_id_branch_id_printed_at_idx" ON "barcode_print_logs"("business_id", "branch_id", "printed_at");

-- CreateIndex
CREATE INDEX "barcode_print_logs_business_id_barcode_value_idx" ON "barcode_print_logs"("business_id", "barcode_value");

-- CreateIndex
CREATE INDEX "sale_items_product_unit_id_idx" ON "sale_items"("product_unit_id");

-- AddForeignKey
ALTER TABLE "product_branches" ADD CONSTRAINT "product_branches_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_branches" ADD CONSTRAINT "product_branches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_branches" ADD CONSTRAINT "product_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_sold_sale_id_fkey" FOREIGN KEY ("sold_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcode_print_logs" ADD CONSTRAINT "barcode_print_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcode_print_logs" ADD CONSTRAINT "barcode_print_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcode_print_logs" ADD CONSTRAINT "barcode_print_logs_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcode_print_logs" ADD CONSTRAINT "barcode_print_logs_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcode_print_logs" ADD CONSTRAINT "barcode_print_logs_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_collections" ADD CONSTRAINT "due_collections_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
