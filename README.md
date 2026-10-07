# Multi-Tenant, Multi-Branch Clothing Retail POS System (Bangladesh Market)

Backend built with **NestJS**, **TypeScript (ESM / NodeNext)**, **PostgreSQL (Supabase)**, and **Prisma 7**.

---

## Architecture & Technology Stack
- **Framework:** NestJS 12 + Express platform
- **Database ORM:** Prisma 7 with WASM/pg adapter (`@prisma/adapter-pg`)
- **Authentication:** JWT (Stateless token verified against active `UserSession` SHA-256 hash in DB)
- **Validation:** `class-validator` + `class-transformer` (global `ValidationPipe` with whitelist and transform)
- **API Documentation:** Swagger OpenAPI at `/api/docs`
- **Request Logging:** `morgan('dev')` terminal logger

---

## Core Business Rules Implemented in Phase 1

1. **Hierarchy & Scoping:**
   - Hierarchy: `Business -> Branches`. Every business has at least one branch (the main branch, `is_main = true`).
   - Everything operational is branch-scoped (stock, sales, registers, expenses, invoice numbers).
   - Customers are shared across all branches of a business (lookup by phone within `business_id`).
2. **Last Active Branch Rule (Critical):**
   - The last active branch of a business can **never** be deleted or deactivated. Attempting to deactivate it throws a `400 Bad Request`.
3. **Plan Branch Limits:**
   - Creating a branch validates active branch counts against `PlanLimit.max_branches` (and any active `SubscriptionOverride.override_max_branches`). Exceeding the limit throws `403 Forbidden`.
4. **Subscription Status Enforcement:**
   - All authenticated requests check the tenant's subscription status. If `SUSPENDED`, requests are immediately rejected with `403 Forbidden`.
5. **Access Control & Branch Context:**
   - Every protected operational request requires header `x-branch-id`.
   - `BranchContextGuard` checks if the user has access via `UserBranchAccess`. Business owners automatically bypass branch restrictions and have full access to all branches.
6. **ACID Business Onboarding:**
   - A single transaction creates: `Business`, `Subscription` (30-day trial), main `Branch` (`is_main: true`), 3 default `Role`s (`OWNER`, `MANAGER`, `CASHIER`) with mapped `RolePermission`s, owner `User`, `UserBranchAccess`, `InvoiceSequence` records (`INV-`, `PO-`, `RET-`, `TRN-`, `JE-`, `EXP-`), default `CashRegister` (`REG-01`), and garment master data (`Unit`, `Size`, `Color`, `ExpenseCategory`).
7. **Security:**
   - Neither `business_id` nor `branch_id` from request bodies are trusted. `business_id` is extracted from the verified JWT payload, and `branch_id` is validated via `x-branch-id` against `UserBranchAccess`.

---

## Getting Started

### 1. Prerequisites
- Node.js `v20.19+`, `v22.12+`, or `v26+`
- `pnpm` (version 9 or 10+)
- PostgreSQL connection string (configured in `.env` as `DATABASE_URL`)

### 2. Environment Configuration
Ensure `.env` in the `backend/` directory contains:
```env
DATABASE_URL="postgresql://postgres.[user]:[password]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
PORT=4000
JWT_SECRET="super-secret-shop-jwt-key-2026"
```

### 3. Install Dependencies & Generate Prisma Client
```bash
pnpm install
npx prisma generate
```

### 4. Seed Permissions, SuperAdmin & Plans
Run the database seed script to populate system permissions, the SuperAdmin user (`admin@pos.com`), and default plans (`STARTER`, `BUSINESS`) with plan limits:
```bash
pnpm run seed
```

### 5. Run the Application
```bash
# Development mode with hot-reload
pnpm run start:dev

# Production build and run
pnpm run build
pnpm run start:prod
```

The server will start at:
- **API URL:** `http://localhost:4000`
- **Swagger Documentation:** `http://localhost:4000/api/docs`

### 6. Run Automated Tests
```bash
pnpm test
```

---

## API Endpoints & cURL / Postman Examples

### 1. Onboarding a New Business
**Endpoint:** `POST /api/v1/onboarding`  
**Access:** Public  
Creates the business, trial subscription, main branch, owner user, default roles, invoice sequences, cash register, and apparel master items in a single transaction.

```bash
curl -X POST http://localhost:4000/api/v1/onboarding \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Aarong Fashion Boutique",
    "businessSlug": "aarong-boutique",
    "phone": "01711000111",
    "email": "owner@aarong-boutique.com",
    "ownerFirstName": "Kamal",
    "ownerLastName": "Hossain",
    "password": "Password123!",
    "branchName": "Gulshan Flagship Showroom",
    "branchCode": "MAIN",
    "branchAddress": "House 12, Road 11, Gulshan-1, Dhaka",
    "branchCity": "Dhaka",
    "planCode": "STARTER"
  }'
```

**Response (201 Created):**
```json
{
  "message": "Business onboarded successfully! Welcome to your Shop Management SaaS.",
  "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
  "session": {
    "id": "uuid",
    "expiresAt": "2026-10-13T..."
  },
  "business": {
    "id": "c1f77d34-...",
    "name": "Aarong Fashion Boutique",
    "slug": "aarong-boutique",
    "phone": "01711000111",
    "email": "owner@aarong-boutique.com",
    "currency": "BDT",
    "timezone": "Asia/Dhaka"
  },
  "mainBranch": {
    "id": "5f64d0bb-...",
    "name": "Gulshan Flagship Showroom",
    "code": "MAIN",
    "address": "House 12, Road 11, Gulshan-1, Dhaka",
    "isMain": true
  },
  "owner": {
    "id": "e2a3c712-...",
    "firstName": "Kamal",
    "lastName": "Hossain",
    "email": "owner@aarong-boutique.com",
    "phone": "01711000111",
    "isOwner": true
  },
  "subscription": {
    "plan": "Starter Boutique Plan",
    "code": "STARTER",
    "status": "TRIAL",
    "trialEndsAt": "2026-11-05T..."
  }
}
```

---

### 2. User Login
**Endpoint:** `POST /api/v1/auth/login`  
**Access:** Public  
Login with either email or phone + password. Optionally supply `businessSlug` to disambiguate identical emails/phones across different tenants.

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "owner@aarong-boutique.com",
    "password": "Password123!",
    "businessSlug": "aarong-boutique"
  }'
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
  "user": {
    "id": "uuid",
    "firstName": "Kamal",
    "lastName": "Hossain",
    "email": "owner@aarong-boutique.com",
    "phone": "01711000111",
    "isOwner": true,
    "role": {
      "id": "uuid",
      "name": "Owner",
      "code": "OWNER"
    }
  },
  "business": {
    "id": "uuid",
    "name": "Aarong Fashion Boutique",
    "slug": "aarong-boutique",
    "currency": "BDT",
    "subscriptionStatus": "TRIAL"
  },
  "accessibleBranches": [
    {
      "id": "5f64d0bb-...",
      "name": "Gulshan Flagship Showroom",
      "code": "MAIN",
      "isMain": true,
      "isDefault": true
    }
  ]
}
```

---

### 3. Get Current User Profile (`/auth/me`)
**Endpoint:** `GET /api/v1/auth/me`  
**Access:** Authenticated (Bearer Token)

```bash
curl -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

---

### 4. Logout (Revoke Session)
**Endpoint:** `POST /api/v1/auth/logout`  
**Access:** Authenticated (Bearer Token)

```bash
curl -X POST http://localhost:4000/api/v1/auth/logout \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

---

### 5. Branch Management

#### A. List Branches
**Endpoint:** `GET /api/v1/branches`  
**Access:** Authenticated

```bash
curl -X GET http://localhost:4000/api/v1/branches \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

#### B. Create Branch
**Endpoint:** `POST /api/v1/branches`  
**Access:** Authenticated (Requires `branches:create` permission or Owner)  
*Note: Subject to subscription `PlanLimit.max_branches`.*

```bash
curl -X POST http://localhost:4000/api/v1/branches \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dhanmondi Showroom",
    "code": "DHANMONDI",
    "address": "House 27, Road 4, Dhanmondi",
    "city": "Dhaka",
    "phone": "01722334455",
    "email": "dhanmondi@aarong-boutique.com"
  }'
```

#### C. Get Single Branch
**Endpoint:** `GET /api/v1/branches/:id`  
**Access:** Authenticated

```bash
curl -X GET http://localhost:4000/api/v1/branches/<BRANCH_UUID> \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

#### D. Update Branch
**Endpoint:** `PATCH /api/v1/branches/:id`  
**Access:** Authenticated (Requires `branches:update` or Owner)

```bash
curl -X PATCH http://localhost:4000/api/v1/branches/<BRANCH_UUID> \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dhanmondi Flagship Outlet",
    "phone": "01722334466"
  }'
```

#### E. Deactivate Branch (Enforces Last Active Branch Rule)
**Endpoint:** `DELETE /api/v1/branches/:id`  
**Access:** Authenticated (Requires `branches:delete` or Owner)  
*Note: If the branch is the only active branch remaining, the server rejects with `400 Bad Request: Cannot deactivate the last active branch of a business`.*

```bash
curl -X DELETE http://localhost:4000/api/v1/branches/<BRANCH_UUID> \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

#### F. Assign User to Branch
**Endpoint:** `POST /api/v1/branches/:id/users`  
**Access:** Authenticated (Requires `branches:assign_user` or Owner)

```bash
curl -X POST http://localhost:4000/api/v1/branches/<BRANCH_UUID>/users \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<STAFF_USER_UUID>",
    "isDefault": true
  }'
```

#### G. Revoke User Access from Branch
**Endpoint:** `DELETE /api/v1/branches/:id/users/:userId`  
**Access:** Authenticated (Requires `branches:assign_user` or Owner)

```bash
curl -X DELETE http://localhost:4000/api/v1/branches/<BRANCH_UUID>/users/<STAFF_USER_UUID> \
  -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>"
```

---

## Operating Scoped Endpoints (Header: `x-branch-id`)
When invoking operational endpoints (such as POS checkout, product stock lookups, cash sessions, expenses), the request must carry the header:
```http
x-branch-id: <branch-uuid>
```
`BranchContextGuard` will:
1. Verify the branch belongs to the user's business and is active.
2. Confirm the user has access to that branch in `UserBranchAccess` (or is the business owner).
3. Attach `{ businessId, userId, branchId, isAllBranchAdmin }` to the request object.

---

## PHASE 2: CATALOG MODULE

The Catalog Module provides a multi-branch garment retail catalog with branch-scoped visibility, variants matrix, inventory tracking, Code 128 barcodes, and custom price lists.

### Phase 2 Business Rules
1. **Branch-Scoped Product Visibility:**
   - Operational branch users see only products that have an active `ProductBranch` row for their branch.
   - Admins/owners (`isAllBranchAdmin`) see all products across the business and can filter using `?branchId=`. Each product includes a `branches` array showing where it is active.
2. **ACID Product Creation:**
   - Creating a product creates the product, auto-assigns it to the current branch (and optional admin multi-branch list), creates variants, and initializes `StockBalance` records in **one database transaction**.
3. **Branch Deactivation Stock Protection:**
   - Deactivating a product in a branch (`is_active = false`) is blocked if that branch still has stock (`StockBalance.quantity > 0`) unless `force = true` is supplied.
4. **Barcode Printing & Audit:**
   - Reprints (`REPRINT`) require an audit reason.
   - Barcode scanning via `GET /api/v1/catalog/barcodes/lookup/:barcode` returns the product if active in the current branch. If it exists in the business but not in this branch, it returns a distinct `PRODUCT_IN_OTHER_BRANCH` code with a list of branches that have stock.
5. **System Master Data Protection:**
   - Sizes, Colors, and Units have system rows (`business_id = null`) accessible by all tenants but immutable and protected from tenant modification or deletion.

---

### Phase 2 Endpoints & cURL Examples

#### 1. Master Data (Shared across business)

##### A. Categories (Hierarchical)
```bash
# Create category
curl -X POST http://localhost:4000/api/v1/catalog/categories \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Men'\''s Panjabi",
    "code": "MENS-PANJABI",
    "description": "Traditional and festive attire"
  }'

# List categories
curl -X GET http://localhost:4000/api/v1/catalog/categories \
  -H "Authorization: Bearer <TOKEN>"
```

##### B. Brands & Seasons
```bash
# Create brand
curl -X POST http://localhost:4000/api/v1/catalog/brands \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Taaga", "code": "TAAGA" }'

# Create season / collection
curl -X POST http://localhost:4000/api/v1/catalog/seasons \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Eid Collection 2026", "code": "EID-2026" }'
```

##### C. Sizes, Colors & Units (Tenant + System)
```bash
# List sizes (includes system sizes e.g. S, M, L, XL, XXL)
curl -X GET http://localhost:4000/api/v1/catalog/sizes \
  -H "Authorization: Bearer <TOKEN>"

# Create custom size
curl -X POST http://localhost:4000/api/v1/catalog/sizes \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Semi-Fit 42", "code": "SF-42", "sortOrder": 10 }'
```

---

#### 2. Products

##### A. Create Product with Variants (Single Transaction)
```bash
curl -X POST http://localhost:4000/api/v1/catalog/products \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Embroidered Cotton Panjabi",
    "code": "PANJ-EMB-01",
    "categoryId": "<CATEGORY_UUID>",
    "unitId": "<UNIT_UUID>",
    "gender": "MEN",
    "fabric": "100% Combed Cotton Jacquard",
    "hasVariants": true,
    "variants": [
      {
        "sizeId": "<SIZE_M_UUID>",
        "colorId": "<COLOR_NAVY_UUID>",
        "sku": "PANJ-EMB-01-M-NVY",
        "retailPrice": 2450.00,
        "wholesalePrice": 1950.00,
        "costPrice": 1400.00,
        "reorderLevel": 5
      },
      {
        "sizeId": "<SIZE_L_UUID>",
        "colorId": "<COLOR_NAVY_UUID>",
        "sku": "PANJ-EMB-01-L-NVY",
        "retailPrice": 2450.00,
        "wholesalePrice": 1950.00,
        "costPrice": 1400.00,
        "reorderLevel": 5
      }
    ]
  }'
```

##### B. List Products with Current Branch Stock & Filters
```bash
curl -X GET "http://localhost:4000/api/v1/catalog/products?search=Panjabi&page=1&limit=20" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>"
```

##### C. Product Detail
```bash
curl -X GET http://localhost:4000/api/v1/catalog/products/<PRODUCT_UUID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>"
```

---

#### 3. Variants & Bulk Matrix Generator

##### A. Bulk Generate Variants (Sizes x Colors Matrix)
Generates all combinations in a single transaction with auto-generated SKUs and Code 128 barcodes:
```bash
curl -X POST http://localhost:4000/api/v1/catalog/variants/products/<PRODUCT_UUID>/bulk \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "sizeIds": ["<SIZE_M_UUID>", "<SIZE_L_UUID>", "<SIZE_XL_UUID>"],
    "colorIds": ["<COLOR_BLACK_UUID>", "<COLOR_WHITE_UUID>"],
    "defaultRetailPrice": 2250.00,
    "defaultWholesalePrice": 1800.00,
    "defaultCostPrice": 1300.00,
    "defaultReorderLevel": 5
  }'
```

---

#### 4. Product-Branch Management (Admin)

##### A. Activate Product in Another Branch
```bash
curl -X POST http://localhost:4000/api/v1/catalog/product-branches/activate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "<PRODUCT_UUID>",
    "branchId": "<TARGET_BRANCH_UUID>"
  }'
```

##### B. Deactivate Product in a Branch (Protected by Stock Check)
```bash
# Standard deactivation (fails if stock > 0)
curl -X POST http://localhost:4000/api/v1/catalog/product-branches/deactivate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "<PRODUCT_UUID>",
    "branchId": "<TARGET_BRANCH_UUID>",
    "force": false
  }'

# Force deactivation
curl -X POST http://localhost:4000/api/v1/catalog/product-branches/deactivate \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "<PRODUCT_UUID>",
    "branchId": "<TARGET_BRANCH_UUID>",
    "force": true
  }'
```

---

#### 5. Barcode & Scanning

##### A. Log Barcode Print
```bash
curl -X POST http://localhost:4000/api/v1/catalog/barcodes/print \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "<VARIANT_UUID>",
    "quantity": 10,
    "printType": "INITIAL_PRINT"
  }'

# Reprint (requires audit reason)
curl -X POST http://localhost:4000/api/v1/catalog/barcodes/print \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "<VARIANT_UUID>",
    "quantity": 1,
    "printType": "REPRINT",
    "reason": "Original customer barcode sticker damaged"
  }'
```

##### B. Barcode Lookup (POS Scanner)
```bash
curl -X GET http://localhost:4000/api/v1/catalog/barcodes/lookup/881234567890 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_BRANCH_UUID>"
```
**Response when active in current branch:**
```json
{
  "found": true,
  "activeInCurrentBranch": true,
  "product": { "id": "...", "name": "Cotton Panjabi", "code": "PANJ-01" },
  "variant": { "sku": "PANJ-M-NVY", "retailPrice": 2450.00, "stock": 18 }
}
```
**Response when product exists in business, but NOT in this branch:**
```json
{
  "found": true,
  "activeInCurrentBranch": false,
  "code": "PRODUCT_IN_OTHER_BRANCH",
  "message": "This product exists in your business catalog but is not assigned or active in this branch.",
  "product": { "id": "...", "name": "Cotton Panjabi" },
  "variant": { "sku": "PANJ-M-NVY", "retailPrice": 2450.00 },
  "availableBranches": [
    {
      "branchId": "5f64d0bb-...",
      "branchName": "Gulshan Flagship Showroom",
      "stock": 12
    }
  ]
}
```

---

#### 6. Custom Price Lists

##### A. Create Price List
```bash
curl -X POST http://localhost:4000/api/v1/catalog/price-lists \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Eid Festive Promotional Offer",
    "code": "EID-OFFER-2026",
    "type": "FESTIVE_OFFER",
    "isDefault": false
  }'
```

##### B. Set Variant Price Override in Price List
```bash
curl -X POST http://localhost:4000/api/v1/catalog/price-lists/<PRICE_LIST_UUID>/items \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "<VARIANT_UUID>",
    "price": 2150.00
  }'
```

---

## Phase 3 - Purchasing & Inventory Management

### Core Business Rules & Architecture Implemented

1. **Single Entry Point for Stock Changes (`StockService.applyMovement`)**:
   - `StockBalance` is modified **exclusively** through `StockService.applyMovement`.
   - Every stock update acquires a pessimistic row lock via PostgreSQL `SELECT ... FOR UPDATE` inside an ongoing Prisma transaction.
   - Negative stock is blocked by default (`INSUFFICIENT_STOCK` error code), respecting `allocated_quantity` (`available = quantity - allocated_quantity`).
   - `StockMovement` rows are immutably logged with `new_wac` and signed quantities.
2. **Weighted Average Cost (WAC)**:
   - On stock-in (`OPENING`, `PURCHASE`, `TRANSFER_IN`, `SALE_RETURN`, `ADJUSTMENT_POSITIVE`):
     $$\text{avg\_cost\_price} = \frac{\text{old\_value} + (\text{in\_qty} \times \text{unit\_cost})}{\text{old\_qty} + \text{in\_qty}}$$
   - On stock-out: unit cost stays at current `avg_cost_price`, and `total_cost_value = quantity \times avg_cost_price`.
   - All calculations use Prisma `Decimal` (zero floating-point math).
3. **Automatic Product Branch Visibility**:
   - Every stock-in automatically invokes `ProductBranchService.ensureProductInBranch` to make the product visible and active in that branch.
4. **Low Stock Notifications**:
   - When available quantity drops below `variant.reorder_level` after a stock-out, a `LOW_STOCK` notification is created for the branch (deduplicated against unread notifications).
5. **Suppliers & Supplier Ledger**:
   - Suppliers are business-wide (`@OptionalBranch()`).
   - Running balance formula: $\text{current\_balance} = \text{opening\_balance} + \text{purchases} - \text{returns} - \text{payments}$.
6. **Purchases (Goods Receipt)**:
   - Atomic execution in a single transaction: `purchase_no` via `InvoiceSequence`, items, stock movements, supplier due updates, optional `SupplierPayment` (when `paidAmount > 0`), and optional `PurchaseOrder` fulfillment.
   - Landed cost flag (`landedCost=true`): proportionally allocates net overhead (`shippingCost - discountAmount`) into variant unit cost for WAC valuation.
   - Individually tracked items (`track_individually=true`): generates unique `ProductUnit` rows (`status: IN_STOCK`).
   - Purchase cancellation: blocked if stock was sold or transferred; reverses stock movements and supplier balance without deleting rows.
7. **Supplier Payments**:
   - Paid against a specific purchase (blocking overpayment against due) or as a general advance.
   - Decrements `Supplier.current_balance` and decrements `Purchase.due_amount`.
8. **Stock Transfers**:
   - Multi-step flow: `PENDING` -> `IN_TRANSIT` (dispatch at source WAC) -> `RECEIVED` (stock-in at destination at transfer cost, recalculating destination WAC).
   - Partial receipt records discrepancies without losing audit trail.
   - Rejection/cancellation after dispatch returns stock to source at transfer cost.
   - `createInstantTransfer`: internal idempotent method using `StockTransfer.idempotency_key`.
9. **Stock Adjustments & Segregation of Duties**:
   - Items record `system_qty`, `physical_qty`, `difference_qty`, `unit_cost`.
   - Stock balance changes **only** on approval (`stock.approve` permission).
   - The creator cannot approve their own adjustment unless they are the business owner.
10. **Stocktake (Physical Count)**:
    - Enforces only one `IN_PROGRESS` stocktake per branch.
    - Takes a snapshot of system stock, allows recording physical counts, and optionally generates a `DRAFT` `StockAdjustment`.
11. **Damaged Stock**:
    - Lifecycle: `PENDING` -> `APPROVED` -> `WRITTEN_OFF`.
    - Stock-out movement (`DAMAGE`) happens on write-off using exact WAC at that moment.
12. **Consistency Checker**:
    - Admin-only tool comparing `StockBalance.quantity` against the sum of `StockMovement` and `ProductUnit` counts, reporting discrepancies without auto-fixing.

---

### Phase 3 API Endpoints & cURL Examples

#### 1. Suppliers (Business-wide)

##### A. Create Supplier
```bash
curl -X POST http://localhost:4000/api/v1/inventory/suppliers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Apex Fabrics Ltd.",
    "code": "SUP-APEX",
    "companyName": "Apex Holdings",
    "phone": "01711223344",
    "email": "contact@apexfabrics.com",
    "city": "Dhaka",
    "openingBalance": 15000.00
  }'
```

##### B. Get Supplier Ledger
```bash
curl -X GET "http://localhost:4000/api/v1/inventory/suppliers/<SUPPLIER_UUID>/ledger?startDate=2026-01-01&endDate=2026-12-31" \
  -H "Authorization: Bearer <TOKEN>"
```

---

#### 2. Purchase Orders

##### A. Create Purchase Order (DRAFT)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/purchase-orders \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "supplierId": "<SUPPLIER_UUID>",
    "expectedDelivery": "2026-10-25",
    "notes": "Winter apparel pre-order",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 100,
        "unitCost": 450.00
      }
    ]
  }'
```

##### B. Issue Purchase Order
```bash
curl -X POST http://localhost:4000/api/v1/inventory/purchase-orders/<PO_UUID>/issue \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 3. Purchases (Goods Receipt)

##### A. Receive Purchase (with Landed Cost & Tracked Units)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/purchases \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "supplierId": "<SUPPLIER_UUID>",
    "supplierInvoiceNo": "INV-APEX-901",
    "discountAmount": 500.00,
    "shippingCost": 800.00,
    "paidAmount": 10000.00,
    "landedCost": true,
    "paymentMethod": "BANK",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 25,
        "unitCost": 500.00
      }
    ]
  }'
```

##### B. Cancel Purchase
```bash
curl -X POST http://localhost:4000/api/v1/inventory/purchases/<PURCHASE_UUID>/cancel \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 4. Supplier Payments

##### A. Pay Against Purchase or Advance
```bash
curl -X POST http://localhost:4000/api/v1/inventory/supplier-payments \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "supplierId": "<SUPPLIER_UUID>",
    "purchaseId": "<PURCHASE_UUID>",
    "amount": 2500.00,
    "paymentMethod": "BANK",
    "referenceNo": "CHQ-001928",
    "notes": "Partial bill clearance"
  }'
```

---

#### 5. Purchase Returns

##### A. Return Items to Supplier
```bash
curl -X POST http://localhost:4000/api/v1/inventory/purchase-returns \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "supplierId": "<SUPPLIER_UUID>",
    "purchaseId": "<PURCHASE_UUID>",
    "reason": "Damaged embroidery",
    "status": "COMPLETED",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 2,
        "unitCost": 500.00
      }
    ]
  }'
```

---

#### 6. Stock Transfers

##### A. Initiate Transfer (PENDING)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/transfers \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <FROM_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "toBranchId": "<TO_BRANCH_UUID>",
    "notes": "Transfer for weekend showroom rush",
    "items": [
      { "variantId": "<VARIANT_UUID>", "sentQty": 10 }
    ]
  }'
```

##### B. Dispatch Transfer
```bash
curl -X POST http://localhost:4000/api/v1/inventory/transfers/<TRANSFER_UUID>/dispatch \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <FROM_BRANCH_UUID>"
```

##### C. Receive Transfer (with Discrepancy Recording)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/transfers/<TRANSFER_UUID>/receive \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <TO_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "itemId": "<TRANSFER_ITEM_UUID>",
        "receivedQty": 9,
        "discrepancyNote": "1 unit missing in transit delivery"
      }
    ]
  }'
```

##### D. Instant Transfer (Admin / Cross-Branch Sale)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/transfers/instant \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <FROM_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromBranchId": "<FROM_BRANCH_UUID>",
    "toBranchId": "<TO_BRANCH_UUID>",
    "idempotencyKey": "pos-auto-trn-9988",
    "items": [
      { "variantId": "<VARIANT_UUID>", "quantity": 1 }
    ]
  }'
```

---

#### 7. Stock Adjustments

##### A. Create DRAFT Adjustment
```bash
curl -X POST http://localhost:4000/api/v1/inventory/adjustments \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "PHYSICAL_COUNT_DISCREPANCY",
    "notes": "Month-end floor count",
    "items": [
      { "variantId": "<VARIANT_UUID>", "physicalQty": 22 }
    ]
  }'
```

##### B. Approve Adjustment (Changes stock; creator cannot approve unless owner)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/adjustments/<ADJUSTMENT_UUID>/approve \
  -H "Authorization: Bearer <MANAGER_OR_OWNER_TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 8. Stocktake

##### A. Start Stocktake
```bash
curl -X POST http://localhost:4000/api/v1/inventory/stocktakes/start \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "categoryId": "<OPTIONAL_CATEGORY_UUID>",
    "notes": "Formal shirts audit"
  }'
```

##### B. Complete Stocktake (Auto-generate Draft Adjustment)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/stocktakes/<STOCKTAKE_UUID>/complete \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "createAdjustment": true
  }'
```

---

#### 9. Damaged Stock

##### A. Report Damaged Stock
```bash
curl -X POST http://localhost:4000/api/v1/inventory/damaged-stock \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "<VARIANT_UUID>",
    "quantity": 2,
    "reason": "Stained during customer fitting"
  }'
```

##### B. Write-Off Damaged Stock (Deducts stock at exact current WAC)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/damaged-stock/<DAMAGE_UUID>/write-off \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 10. Stock Queries & Valuation

##### A. Current Stock with Filters & Pagination
```bash
curl -X GET "http://localhost:4000/api/v1/inventory/stock?page=1&limit=20&lowStockOnly=true" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### B. All-Branches Stock Summary (Admins Only)
```bash
curl -X GET http://localhost:4000/api/v1/inventory/stock/all-branches-summary \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### C. Stock Movement Audit History
```bash
curl -X GET "http://localhost:4000/api/v1/inventory/stock/movements?variantId=<VARIANT_UUID>" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### D. Stock Valuation Report
```bash
curl -X GET http://localhost:4000/api/v1/inventory/stock/valuation \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### E. Opening Stock Entry (Allowed only if zero prior movements)
```bash
curl -X POST http://localhost:4000/api/v1/inventory/stock/opening \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "<VARIANT_UUID>",
    "quantity": 50,
    "unitCost": 350.00
  }'
```

##### F. Consistency Verification Tool (Admin Only)
```bash
curl -X GET http://localhost:4000/api/v1/inventory/stock/consistency-check \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

## Phase 4: POS Sales & Customer Management

### Architecture & Key Design Decisions

1. **Business-Wide Customers vs. Branch-Scoped Sales:**
   - `Customer` is business-wide. A customer registered at Gulshan branch is immediately discoverable at Dhanmondi or Uttara branches.
   - **Phone Normalization:** All Bangladesh phone numbers are canonicalized to the standard 11-digit format `01[3-9]\d{8}` (e.g. `+8801712345678`, `8801712345678`, `01712-345678` all normalize to `01712345678`). This eliminates duplicate customer records across branches and guarantees phone lookup reliability.
   - `Sale`, `SalePayment`, `RegisterSession`, `HeldSale`, and `InvoiceSequence` remain strictly branch-scoped.
2. **Server-Side Recalculation & Zero-Float Arithmetic:**
   - Client-sent totals are strictly ignored. All line totals, role-based discounts, coupon limits, tax rates, and Bangladesh Taka integer round-offs (`round_off`) are recomputed on the server using `Prisma.Decimal`.
3. **One Atomic Transaction:**
   - Sale creation, cross-branch auto-transfers, stock deduction through `StockService.applyMovement`, tracked unit state updates (`SOLD`), `SalePayment` creation, customer due increments, loyalty points, SMS queueing, and audit logging execute inside a single Prisma transaction (`prisma.$transaction`).
4. **Cross-Branch Sales (Auto-Transfer):**
   - When selling stock located in another branch (`source_branch_id`), the server automatically executes `StockTransferService.createInstantTransfer` inside the **same sale transaction** before the sale stock-out. The transfer uses derived idempotency key `${sale.idempotency_key}:${source_branch_id}` and immediately ensures product assignment in the selling branch.
   - If the sale transaction fails or rolls back, the transfer rolls back with it.
   - Offline sales (`is_offline: true`) are prohibited from initiating cross-branch transfers.
5. **Void Sale & Payment Reversal Decision:**
   - When a sale is voided (`POST /api/v1/sales/:id/void`), original `SalePayment` rows are **never deleted**.
   - Instead, the system inserts compensating negative `SalePayment` rows with derived idempotency keys (`${payment.idempotency_key}:void`, `amount: -payment.amount`). This preserves an immutable audit trail, keeps drawer shift accounting consistent, and zeros out the net sale amount.
   - Cross-branch transferred stock remains in the selling branch upon void (auto-transfers are not reversed).

---

### Phase 4 Endpoints & cURL Examples

#### 1. Customers (Business-Wide)

##### A. Quick-Create Customer (POS Cashier)
```bash
curl -X POST http://localhost:4000/api/v1/customers/quick \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tanvir Ahmed",
    "phone": "+8801712345678"
  }'
```

##### B. Customer Phone Lookup (Cross-Branch)
```bash
curl -X GET "http://localhost:4000/api/v1/customers/lookup?phone=01712345678" \
  -H "Authorization: Bearer <TOKEN>"
```

##### C. Customer Ledger & Running Due
```bash
curl -X GET "http://localhost:4000/api/v1/customers/ledger/<CUSTOMER_UUID>" \
  -H "Authorization: Bearer <TOKEN>"
```

##### D. Customer Due Summary by Branch (Read-Only)
```bash
curl -X GET http://localhost:4000/api/v1/customers/due-summary \
  -H "Authorization: Bearer <TOKEN>"
```

---

#### 2. Cash Register Sessions

##### A. Open Register Session
```bash
curl -X POST http://localhost:4000/api/v1/sales/register-sessions/open \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "cashRegisterId": "<CASH_REGISTER_UUID>",
    "openingBalance": 2000.00
  }'
```

##### B. Get Current Active Register Session
```bash
curl -X GET http://localhost:4000/api/v1/sales/register-sessions/current \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 3. Cart Pricing Calculation (No DB Writes)

```bash
curl -X POST http://localhost:4000/api/v1/sales/calculate \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "saleType": "RETAIL",
    "couponCode": "EID2026",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 2,
        "discountAmount": 50.00
      }
    ]
  }'
```

---

#### 4. POS Sale Transactions

##### A. Normal POS Sale (Cash Tender with Change)
```bash
curl -X POST http://localhost:4000/api/v1/sales \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "pos-sale-20261006-001",
    "saleType": "RETAIL",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 1
      }
    ],
    "payments": [
      {
        "paymentMethod": "CASH",
        "amount": 2000.00
      }
    ]
  }'
```

##### B. Credit Sale (Requires Registered Customer & Credit Limit)
```bash
curl -X POST http://localhost:4000/api/v1/sales \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "pos-credit-sale-002",
    "customerId": "<CUSTOMER_UUID>",
    "saleType": "RETAIL",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 2
      }
    ],
    "payments": [
      {
        "paymentMethod": "BKASH",
        "amount": 1000.00,
        "transactionNo": "TRX-BKASH-8812"
      }
    ]
  }'
```

##### C. Cross-Branch Sale (Auto-Transfer Stock from Source Branch)
```bash
curl -X POST http://localhost:4000/api/v1/sales \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_GULSHAN_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "pos-cross-branch-sale-003",
    "saleType": "RETAIL",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 1,
        "sourceBranchId": "<BRANCH_DHANMONDI_UUID>"
      }
    ],
    "payments": [
      {
        "paymentMethod": "CARDS",
        "amount": 2500.00,
        "transactionNo": "POS-CARD-APPROVAL-991"
      }
    ]
  }'
```

##### D. Tracked Unit Barcode Sale
```bash
curl -X POST http://localhost:4000/api/v1/sales \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "pos-tracked-sale-004",
    "saleType": "RETAIL",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 1,
        "productUnitBarcode": "UNIT-BARCODE-1002"
      }
    ],
    "payments": [
      {
        "paymentMethod": "CASH",
        "amount": 4500.00
      }
    ]
  }'
```

---

#### 5. Void Sale (Reverse Stock & Ledger Payments)

```bash
curl -X POST http://localhost:4000/api/v1/sales/<SALE_UUID>/void \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Customer returned wrong garment item immediately before leaving counter"
  }'
```

---

#### 6. Held Sales (Cart Park & Retrieve)

##### A. Hold Cart (No Stock Allocation)
```bash
curl -X POST http://localhost:4000/api/v1/sales/held \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceName": "Customer waiting for friend - Counter 1",
    "items": [
      {
        "variantId": "<VARIANT_UUID>",
        "quantity": 2
      }
    ]
  }'
```

##### B. List Held Sales
```bash
curl -X GET http://localhost:4000/api/v1/sales/held \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### C. Retrieve & Re-Price Held Cart
```bash
curl -X POST http://localhost:4000/api/v1/sales/held/<HELD_SALE_UUID>/retrieve \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 7. Sales Reporting & Queries

##### A. Branch Sales List with Filters
```bash
curl -X GET "http://localhost:4000/api/v1/sales?page=1&limit=20&status=COMPLETED" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### B. Daily Sales Summary (Payment Breakdown & Profit)
```bash
curl -X GET "http://localhost:4000/api/v1/sales/reports/daily-summary?date=2026-10-06" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### C. Sales Report by Product, Category, or Brand
```bash
curl -X GET "http://localhost:4000/api/v1/sales/reports/by-group?groupBy=brand" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

## Phase 5: Returns, Exchange, Due Collection, Expenses, Cash Movements, Register Close

### Architecture & Key Design Decisions

1. **SequenceType Additions & Phase 3/4 Numbers Migration:**
   - **Phase 3/4 Workarounds:** Phase 3 originally shared `PURCHASE_INVOICE` with prefix `'PO-'` for Purchase Orders, `EXPENSE_VOUCHER` with prefix `'PAY-'` for Supplier Payments, and `RETURN_INVOICE` with prefix `'RET-'` for Purchase Returns.
   - **Phase 5 Strategy:** In Phase 5, we added `DUE_COLLECTION`, `SALES_RETURN`, `EXCHANGE`, `SUPPLIER_PAYMENT`, `STOCK_ADJUSTMENT`, `STOCKTAKE`, `DAMAGE`, and `PURCHASE_ORDER` to `enum SequenceType` via an additive, non-breaking migration. Existing historical sequence numbers are kept intact to preserve immutability and fiscal continuity, and `SequenceService` uses the dedicated enum types going forward with atomic upserts (`SR-`, `EXC-`, `COL-`, `EXP-`, `DMG-`, `PO-`).
2. **Exchange Credit Representation & Cash Drawer Integrity:**
   - In an exchange, the returned value acts as merchandise store credit towards the new sale.
   - **Design Decision:** On the newly generated `Sale`, `total_amount = new_items_total`, and `paid_amount = credit_applied + real_payments`. Crucially, `SalePayment` rows are created **ONLY for real tender** (cash, card, mobile money). No artificial "STORE_CREDIT" payment rows are inserted into `sale_payments`. This guarantees that register session cash summaries, drawer shift reconciliations, and payment tender reports remain 100% accurate and reflect physical cash in drawer.
3. **Partial-Return Sale Status:**
   - **Design Decision:** When a sale is partially returned, the parent `Sale.status` is **not** changed to `RETURNED`. It retains its active status (`COMPLETED`, `PARTIALLY_PAID`, etc.) and the system tracks return progress via `SaleItem.returned_qty`. `Sale.status` transitions to `RETURNED` only when every single item on the invoice has been 100% returned (`returned_qty == quantity`). This prevents premature invoice invalidation on partial returns while keeping reporting unambiguous.
4. **Damaged-Return Handling & Stock Ledger Reconcilement:**
   - **Design Decision:** When customer returns a garment in `DAMAGED` condition, it must never become sellable in `StockBalance`. To maintain an unbroken double-entry audit trail in `StockMovement`, the system executes two atomic movements:
     1. A `SALE_RETURN` stock-in into the accepting branch at the original `unit_cost` (reversing the sale from the customer).
     2. A subsequent `DAMAGE` stock-out from the accepting branch at the same `unit_cost` (recording the loss).
     3. Simultaneously creates a `DamagedStock` row with status `WRITTEN_OFF` and the provided damage reason.
     This ensures the branch movement ledger perfectly reconciles without ever showing damaged items as available stock.
5. **Expense Delete & Update Behavior:**
   - **Design Decision:** The `expenses` schema does not contain a `deleted_at` column. Soft-delete without schema changes was not possible. Therefore, `DELETE /api/v1/expenses/:id` performs a hard delete, but **strictly captures an immutable snapshot of all expense fields into `AuditLog` (action: DELETE)** before removing the row.
   - For updates, if an expense was linked to a register session that is now `CLOSED`, edits are locked unless the user holds `expense.update` permission and supplies a mandatory audit reason.
6. **Register Session Cash Tracking:**
   - `register_session_id` was added to `DueCollection`, `SalesReturn`, and `Expense` via relation to `RegisterSession`.
   - The register close expected balance calculation is:
     $$\text{Expected Balance} = \text{Opening} + \text{Cash Sales} + \text{Cash Dues} + \text{Pay-Ins} - \text{Pay-Outs} - \text{Cash Returns} - \text{Cash Exchange Refunds} - \text{Cash Expenses (paid from register)}$$
   - Voided sales in Phase 4 insert negative cash `SalePayment` records into the same session, which automatically net out in this formula.
7. **Tracked Unit Audit Preservation:**
   - When tracked barcode units are returned, `ProductUnit.status` is updated to `IN_STOCK` (or `DAMAGED`) and `branch_id` is updated to the accepting branch. `sold_sale_id` and `sold_at` are deliberately preserved on the unit row to maintain immutable traceability of previous sale history.

---

### Phase 5 Endpoints & cURL Examples

#### 1. Sales Returns

##### A. Partial Return (Resellable Stock, Cash Refund)
```bash
curl -X POST http://localhost:4000/api/v1/sales/returns \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "saleId": "<SALE_UUID>",
    "items": [
      {
        "saleItemId": "<SALE_ITEM_UUID>",
        "quantity": 1,
        "condition": "RESELLABLE"
      }
    ],
    "refundMethod": "CASH",
    "reason": "Customer requested size change return",
    "idempotencyKey": "return-20261007-001"
  }'
```

##### B. Damaged Return (Stock-In + Damage Write-Off)
```bash
curl -X POST http://localhost:4000/api/v1/sales/returns \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceNo": "INV-000045",
    "items": [
      {
        "saleItemId": "<SALE_ITEM_UUID>",
        "quantity": 1,
        "condition": "DAMAGED"
      }
    ],
    "refundMethod": "CASH",
    "reason": "Torn fabric defect discovered by customer",
    "idempotencyKey": "return-20261007-002"
  }'
```

##### C. Cross-Branch Return (Sale made in another branch)
```bash
# Requires "return.cross_branch" permission
curl -X POST http://localhost:4000/api/v1/sales/returns \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <CURRENT_ACCEPTING_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceNo": "INV-000021",
    "items": [
      {
        "saleItemId": "<SALE_ITEM_UUID>",
        "quantity": 1,
        "condition": "RESELLABLE"
      }
    ],
    "refundMethod": "CASH",
    "reason": "Customer traveling, returned at Gulshan showroom",
    "idempotencyKey": "return-cross-branch-001"
  }'
```

##### D. Get Printable Return Slip
```bash
curl -X GET http://localhost:4000/api/v1/sales/returns/<RETURN_UUID>/slip \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 2. Merchandise Exchanges

##### A. Exchange with Extra Payment (Customer Pays Difference)
```bash
curl -X POST http://localhost:4000/api/v1/sales/exchanges \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "originalSaleId": "<ORIGINAL_SALE_UUID>",
    "returnedItems": [
      {
        "saleItemId": "<SALE_ITEM_UUID>",
        "quantity": 1,
        "condition": "RESELLABLE"
      }
    ],
    "newItems": [
      {
        "variantId": "<NEW_VARIANT_UUID>",
        "quantity": 1
      }
    ],
    "payments": [
      {
        "paymentMethod": "CASH",
        "amount": 350.00
      }
    ],
    "reason": "Exchanged Medium Polo for Premium Denim",
    "idempotencyKey": "exchange-20261007-001"
  }'
```

##### B. Get Full Exchange Detail
```bash
curl -X GET http://localhost:4000/api/v1/sales/exchanges/<EXCHANGE_UUID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 3. Customer Due Collection

##### A. Due Collection in Branch 2 for Sales Across Any Branch
```bash
curl -X POST http://localhost:4000/api/v1/sales/due-collections \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <RECEIVING_BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "<CUSTOMER_UUID>",
    "amount": 2500.00,
    "paymentMethod": "CASH",
    "notes": "Partial credit payment received at Dhanmondi counter",
    "idempotencyKey": "due-col-20261007-001"
  }'
```

##### B. Outstanding Due Aging Report (0-30, 31-60, 61-90, 90+ Days)
```bash
curl -X GET http://localhost:4000/api/v1/sales/due-collections/reports/outstanding \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### C. Per-Branch Outstanding Due Split
```bash
curl -X GET http://localhost:4000/api/v1/sales/due-collections/reports/branch-split \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### D. Get Due Collection Money Receipt
```bash
curl -X GET http://localhost:4000/api/v1/sales/due-collections/<COLLECTION_UUID>/receipt \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 4. Showroom Expenses

##### A. Expense Paid from Register Drawer (Reduces Expected Drawer Cash)
```bash
curl -X POST http://localhost:4000/api/v1/expenses \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "expenseCategoryId": "<CATEGORY_UUID>",
    "amount": 450.00,
    "taxAmount": 0.00,
    "vendorName": "Gulshan Electric Supply",
    "receiptNo": "BILL-9821",
    "description": "Emergency showroom tube light replacement",
    "paymentMethod": "CASH",
    "paidFromRegister": true
  }'
```

##### B. Expense Category CRUD
```bash
curl -X POST http://localhost:4000/api/v1/expenses/categories \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Showroom Maintenance",
    "code": "MAINTENANCE",
    "description": "Repairs, cleaning supplies, and store fixtures"
  }'
```

##### C. Expense Summary Report
```bash
curl -X GET "http://localhost:4000/api/v1/expenses/reports/summary?startDate=2026-10-01" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 5. Cash Movements (Drawer In / Out)

##### A. Cash Pay-In (Opening petty cash add)
```bash
curl -X POST http://localhost:4000/api/v1/sales/register-sessions/cash-movements \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "PAY_IN",
    "amount": 2000.00,
    "reason": "Additional change coins received from bank"
  }'
```

##### B. Cash Pay-Out (Validated against live drawer cash)
```bash
curl -X POST http://localhost:4000/api/v1/sales/register-sessions/cash-movements \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "PAY_OUT",
    "amount": 1000.00,
    "reason": "Mid-day cash drop to branch vault"
  }'
```

---

#### 6. Register Reconciliation & Shift Close (X & Z Reports)

##### A. Live X Report (Session Summary without side-effects)
```bash
curl -X GET http://localhost:4000/api/v1/sales/register-sessions/summary \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### B. Register Close (Z Report with Discrepancy & Manager Alerts)
```bash
curl -X POST http://localhost:4000/api/v1/sales/register-sessions/close \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>" \
  -H "Content-Type: application/json" \
  -d '{
    "closingBalance": 7450.00,
    "closingNotes": "{\"denominations\":{\"1000\":6,\"500\":2,\"100\":4,\"50\":1},\"varianceReason\":\"Short 50 Tk due to minor coin dispensing discrepancy\"}"
  }'
```

##### C. Branch Daily Cash Book
```bash
curl -X GET "http://localhost:4000/api/v1/sales/register-sessions/cash-book?date=2026-10-07" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

---

#### 7. Profit & Branch Summary Reports

##### A. Branch and Combined Profit & Loss Report
```bash
curl -X GET "http://localhost:4000/api/v1/sales/reports/profit?startDate=2026-10-01&endDate=2026-10-07" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```

##### B. Payment Tender Collections Summary
```bash
curl -X GET "http://localhost:4000/api/v1/sales/reports/collections?startDate=2026-10-07" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-branch-id: <BRANCH_UUID>"
```



