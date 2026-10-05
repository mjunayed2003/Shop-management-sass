-- ============================================================================
-- POSTGRESQL EXTENSIONS, CONSTRAINTS, RLS POLICIES & TRIGGERS
-- Multi-Tenant SaaS Shop Management System (Clothing - Bangladesh)
-- Currency: BDT | Timezone: Asia/Dhaka
-- ============================================================================

-- Enable pgcrypto / uuid-ossp for cryptographic functions if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. DATABASE CHECK CONSTRAINTS
-- ============================================================================

-- Pricing & Stock Constraints
ALTER TABLE products 
  ADD CONSTRAINT chk_products_active_flag CHECK (is_active IN (true, false)),
  ADD CONSTRAINT chk_products_track_indiv CHECK (track_individually IN (true, false));

ALTER TABLE product_variants 
  ADD CONSTRAINT chk_pv_retail_price_positive CHECK (retail_price >= 0),
  ADD CONSTRAINT chk_pv_wholesale_price_positive CHECK (wholesale_price >= 0),
  ADD CONSTRAINT chk_pv_cost_price_positive CHECK (cost_price >= 0),
  ADD CONSTRAINT chk_pv_reorder_level_non_neg CHECK (reorder_level >= 0);

-- Product Units: 1D Code 128 format (10 to 12 alphanumeric characters)
ALTER TABLE product_units
  ADD CONSTRAINT chk_pu_barcode_format CHECK (barcode_value ~ '^[A-Za-z0-9]{10,12}$');

-- Barcode Print Logs: Reprints require reason
ALTER TABLE barcode_print_logs
  ADD CONSTRAINT chk_reprint_reason_required CHECK (
    print_type <> 'REPRINT' OR (reason IS NOT NULL AND length(trim(reason)) > 0)
  ),
  ADD CONSTRAINT chk_bpl_qty_positive CHECK (quantity_printed > 0);


-- Stock Movement Constraints
ALTER TABLE stock_movements
  ADD CONSTRAINT chk_sm_unit_cost_non_neg CHECK (unit_cost >= 0),
  ADD CONSTRAINT chk_sm_new_wac_non_neg CHECK (new_wac >= 0);

-- Stock Transfer Constraints
ALTER TABLE stock_transfers
  ADD CONSTRAINT chk_st_distinct_branches CHECK (from_branch_id <> to_branch_id);

ALTER TABLE stock_transfer_items
  ADD CONSTRAINT chk_sti_sent_qty_positive CHECK (sent_qty > 0),
  ADD CONSTRAINT chk_sti_received_qty_valid CHECK (received_qty >= 0 AND received_qty <= sent_qty),
  ADD CONSTRAINT chk_sti_unit_cost_non_neg CHECK (unit_cost >= 0);

-- Sales & Items Constraints
ALTER TABLE sales
  ADD CONSTRAINT chk_sales_amounts CHECK (
    subtotal >= 0 AND 
    discount_amount >= 0 AND 
    tax_amount >= 0 AND 
    total_amount >= 0 AND 
    paid_amount >= 0 AND 
    due_amount >= 0 AND 
    change_amount >= 0
  ),
  ADD CONSTRAINT chk_sales_math CHECK (
    paid_amount + due_amount >= total_amount - 1.00 -- allows small round-off adjustment
  );

ALTER TABLE sale_items
  ADD CONSTRAINT chk_si_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_si_unit_price_non_neg CHECK (unit_price >= 0),
  ADD CONSTRAINT chk_si_unit_cost_non_neg CHECK (unit_cost >= 0),
  ADD CONSTRAINT chk_si_returned_qty_valid CHECK (returned_qty >= 0 AND returned_qty <= quantity),
  ADD CONSTRAINT chk_si_discount_non_neg CHECK (discount_amount >= 0),
  ADD CONSTRAINT chk_si_total_non_neg CHECK (total_amount >= 0);

ALTER TABLE sale_payments
  ADD CONSTRAINT chk_sp_amount_positive CHECK (amount > 0);

ALTER TABLE sales_returns
  ADD CONSTRAINT chk_sr_refund_non_neg CHECK (total_refund_amount >= 0);

ALTER TABLE sales_return_items
  ADD CONSTRAINT chk_sri_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_sri_refund_price_non_neg CHECK (refund_price >= 0);

-- Purchasing Constraints
ALTER TABLE purchases
  ADD CONSTRAINT chk_purchase_amounts CHECK (
    subtotal >= 0 AND 
    total_amount >= 0 AND 
    paid_amount >= 0 AND 
    due_amount >= 0
  );

ALTER TABLE purchase_items
  ADD CONSTRAINT chk_pi_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_pi_unit_cost_positive CHECK (unit_cost >= 0);

ALTER TABLE purchase_returns
  ADD CONSTRAINT chk_pr_total_amount_positive CHECK (total_amount >= 0);

ALTER TABLE purchase_return_items
  ADD CONSTRAINT chk_pri_qty_positive CHECK (quantity > 0),
  ADD CONSTRAINT chk_pri_unit_cost_positive CHECK (unit_cost >= 0);

-- Accounting Constraints (Double-entry balance check)
ALTER TABLE journal_entries
  ADD CONSTRAINT chk_je_balance CHECK (
    (status <> 'POSTED') OR (total_debit = total_credit)
  ),
  ADD CONSTRAINT chk_je_non_neg CHECK (total_debit >= 0 AND total_credit >= 0);

ALTER TABLE journal_lines
  ADD CONSTRAINT chk_jl_non_neg CHECK (debit >= 0 AND credit >= 0),
  ADD CONSTRAINT chk_jl_exclusive_dr_cr CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  );

ALTER TABLE expenses
  ADD CONSTRAINT chk_expenses_amount_positive CHECK (amount > 0 AND total_amount >= 0);

-- ============================================================================
-- 2. PARTIAL UNIQUE INDEXES (Soft Delete & Filtered Uniqueness)
-- ============================================================================

-- Only one main branch per business
CREATE UNIQUE INDEX idx_branches_unique_main_per_business 
  ON branches (business_id) 
  WHERE is_main = true AND deleted_at IS NULL;

-- Unique email & phone for active users only
CREATE UNIQUE INDEX idx_users_active_email 
  ON users (business_id, lower(email)) 
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_users_active_phone 
  ON users (business_id, phone) 
  WHERE deleted_at IS NULL;

-- Unique active SKUs and Barcodes
CREATE UNIQUE INDEX idx_pv_active_sku 
  ON product_variants (business_id, sku) 
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_pv_active_barcode 
  ON product_variants (business_id, barcode) 
  WHERE deleted_at IS NULL;

-- Unique active Customers per phone
CREATE UNIQUE INDEX idx_customers_active_phone 
  ON customers (business_id, phone) 
  WHERE deleted_at IS NULL;

-- Only one OPEN register session per cash register
CREATE UNIQUE INDEX idx_register_sessions_single_open 
  ON register_sessions (cash_register_id) 
  WHERE status = 'OPEN';

-- ============================================================================
-- 3. IMMUTABILITY & AUDIT TRIGGERS
-- ============================================================================

-- Function: Block modification or deletion of Stock Ledger movements
CREATE OR REPLACE FUNCTION trg_prevent_stock_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Stock ledger movements are strictly immutable. Correction rows must be appended instead of modifying or deleting ID %', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_stock_movement_mutation();

-- Function: Block modification or deletion of POSTED Journal Entries & Lines
CREATE OR REPLACE FUNCTION trg_prevent_posted_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_posted = true THEN
    RAISE EXCEPTION 'Posted journal entries cannot be updated or deleted. Please create a reversing entry.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_journal_mutation();

CREATE OR REPLACE FUNCTION trg_prevent_posted_journal_lines_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_is_posted BOOLEAN;
BEGIN
  SELECT is_posted INTO v_is_posted FROM journal_entries WHERE id = OLD.journal_entry_id;
  IF v_is_posted = true THEN
    RAISE EXCEPTION 'Lines belonging to posted journal entry % are immutable.', OLD.journal_entry_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_posted_journal_lines_mutation();

-- Function: Block direct modification or deletion of completed Sales
CREATE OR REPLACE FUNCTION trg_prevent_completed_sales_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales invoices cannot be deleted. Use returns or voids for corrections.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Only allow status transitions (such as to VOIDED or RETURNED)
    IF OLD.status IN ('COMPLETED', 'VOIDED', 'RETURNED') AND 
       (NEW.total_amount <> OLD.total_amount OR NEW.subtotal <> OLD.subtotal OR NEW.invoice_no <> OLD.invoice_no) THEN
      RAISE EXCEPTION 'Financial values of completed sale invoice % cannot be altered.', OLD.invoice_no;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sales_immutable
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION trg_prevent_completed_sales_mutation();

-- Function: Block scanning / selling of already SOLD or unavailable physical garment units
CREATE OR REPLACE FUNCTION trg_verify_unit_availability_before_sale()
RETURNS TRIGGER AS $$
DECLARE
  v_unit_status VARCHAR(50);
  v_barcode VARCHAR(50);
  v_sold_sale_id UUID;
  v_sold_at TIMESTAMPTZ;
BEGIN
  IF NEW.product_unit_id IS NOT NULL THEN
    SELECT status, barcode_value, sold_sale_id, sold_at 
    INTO v_unit_status, v_barcode, v_sold_sale_id, v_sold_at
    FROM product_units 
    WHERE id = NEW.product_unit_id;

    IF v_unit_status = 'SOLD' THEN
      RAISE EXCEPTION 'ALREADY SOLD: Physical unit barcode [%] was ALREADY SOLD on sale invoice ID [%] at [%]. Sale is blocked!', 
        v_barcode, v_sold_sale_id, v_sold_at;
    ELSIF v_unit_status <> 'IN_STOCK' THEN
      RAISE EXCEPTION 'NOT AVAILABLE: Physical unit barcode [%] cannot be sold. Current status is [%]. Sale is blocked!', 
        v_barcode, v_unit_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_items_block_already_sold_units
  BEFORE INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION trg_verify_unit_availability_before_sale();

-- Function: Automatically sync product_units status to SOLD on sale completion
CREATE OR REPLACE FUNCTION trg_mark_unit_sold_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.product_unit_id IS NOT NULL THEN
    UPDATE product_units
    SET status = 'SOLD',
        sold_sale_id = NEW.sale_id,
        sold_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.product_unit_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_items_mark_unit_sold
  AFTER INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION trg_mark_unit_sold_on_sale();

-- ============================================================================
-- 4. POSTGRESQL ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Set session context:
-- SET LOCAL app.current_business_id = '00000000-0000-0000-0000-000000000000';
-- SET LOCAL app.is_super_admin = 'false';

-- Macro helper for Tenant RLS:
-- USING (
--   current_setting('app.is_super_admin', true) = 'true' 
--   OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
-- )

-- Apply RLS on Tenant tables:
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE barcode_print_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE damaged_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE due_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

-- Business Isolation Policy Template
CREATE POLICY product_units_isolation_policy ON product_units
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY barcode_print_logs_isolation_policy ON barcode_print_logs
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );
CREATE POLICY business_isolation_policy ON businesses
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY branch_isolation_policy ON branches
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY product_isolation_policy ON products
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY pv_isolation_policy ON product_variants
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY stock_movements_isolation_policy ON stock_movements
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY sales_isolation_policy ON sales
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY journal_isolation_policy ON journal_entries
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY audit_logs_isolation_policy ON audit_logs
  FOR ALL USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

-- ============================================================================
-- 5. TABLE PARTITIONING STRATEGY (High-Growth Tables)
-- ============================================================================

/*
For high-scale production deployment, range partition high-throughput ledger tables:
1. stock_movements BY RANGE (created_at) - Monthly partitions
2. sales BY RANGE (sale_date) - Monthly partitions
3. audit_logs BY RANGE (created_at) - Monthly partitions

Example DDL for stock_movements:
CREATE TABLE stock_movements_partitioned (
    id UUID NOT NULL,
    business_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    product_variant_id UUID NOT NULL,
    movement_type VARCHAR(50) NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL,
    unit_cost NUMERIC(18, 2) NOT NULL,
    new_wac NUMERIC(18, 2) NOT NULL,
    reference_type VARCHAR(50) NOT NULL,
    reference_id UUID NOT NULL,
    batch_no VARCHAR(100),
    remarks TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partitions for 2026:
CREATE TABLE stock_movements_y2026m10 PARTITION OF stock_movements_partitioned
    FOR VALUES FROM ('2026-10-01 00:00:00+06') TO ('2026-11-01 00:00:00+06');
CREATE TABLE stock_movements_y2026m11 PARTITION OF stock_movements_partitioned
    FOR VALUES FROM ('2026-11-01 00:00:00+06') TO ('2026-12-01 00:00:00+06');
*/
