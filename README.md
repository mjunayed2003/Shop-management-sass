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
