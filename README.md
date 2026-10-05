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

