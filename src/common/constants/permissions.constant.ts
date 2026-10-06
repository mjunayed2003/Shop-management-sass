export const PERMISSIONS = {
  // Business & Branch Management
  BRANCHES_CREATE: 'branches:create',
  BRANCHES_READ: 'branches:read',
  BRANCHES_UPDATE: 'branches:update',
  BRANCHES_DELETE: 'branches:delete',
  BRANCHES_ASSIGN_USER: 'branches:assign_user',

  // User & Role Management
  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  ROLES_MANAGE: 'roles:manage',

  // Catalog
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_READ: 'products:read',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  CATEGORIES_MANAGE: 'categories:manage',
  BRANDS_MANAGE: 'brands:manage',

  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_TRANSFER: 'inventory:transfer',
  INVENTORY_STOCKTAKE: 'inventory:stocktake',
  STOCK_APPROVE: 'stock:approve',
  BARCODE_PRINT: 'barcode:print',
  BARCODE_REPRINT: 'barcode:reprint',

  // Sales & POS
  POS_ACCESS: 'pos:access',
  SALES_CREATE: 'sales:create',
  SALES_READ: 'sales:read',
  SALES_RETURN: 'sales:return',
  SALES_EXCHANGE: 'sales:exchange',
  SALES_VOID: 'sales:void',
  DUE_COLLECT: 'due:collect',

  // Purchasing
  PURCHASES_CREATE: 'purchases:create',
  PURCHASES_READ: 'purchases:read',
  PURCHASES_RETURN: 'purchases:return',
  SUPPLIERS_MANAGE: 'suppliers:manage',

  // Cash Register
  CASH_REGISTER_OPEN_CLOSE: 'cash_register:open_close',
  CASH_REGISTER_VIEW: 'cash_register:view',
  CASH_MOVE: 'cash:move',

  // Expenses & Accounting
  EXPENSES_CREATE: 'expenses:create',
  EXPENSES_READ: 'expenses:read',
  EXPENSES_DELETE: 'expenses:delete',
  REPORTS_VIEW: 'reports:view',
} as const;

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
}

export const ALL_SYSTEM_PERMISSIONS: PermissionDefinition[] = [
  // Branches
  { code: PERMISSIONS.BRANCHES_CREATE, name: 'Create Branch', module: 'Branches', description: 'Can create new branches under the business' },
  { code: PERMISSIONS.BRANCHES_READ, name: 'View Branches', module: 'Branches', description: 'Can view branch information' },
  { code: PERMISSIONS.BRANCHES_UPDATE, name: 'Update Branch', module: 'Branches', description: 'Can update branch details' },
  { code: PERMISSIONS.BRANCHES_DELETE, name: 'Deactivate Branch', module: 'Branches', description: 'Can deactivate branches' },
  { code: PERMISSIONS.BRANCHES_ASSIGN_USER, name: 'Assign Users to Branch', module: 'Branches', description: 'Can grant users access to branches' },

  // Users & Roles
  { code: PERMISSIONS.USERS_CREATE, name: 'Create User', module: 'Users', description: 'Can create staff users' },
  { code: PERMISSIONS.USERS_READ, name: 'View Users', module: 'Users', description: 'Can view staff users list' },
  { code: PERMISSIONS.USERS_UPDATE, name: 'Update User', module: 'Users', description: 'Can update staff information' },
  { code: PERMISSIONS.USERS_DELETE, name: 'Delete User', module: 'Users', description: 'Can deactivate or soft-delete staff' },
  { code: PERMISSIONS.ROLES_MANAGE, name: 'Manage Roles', module: 'Users', description: 'Can create and configure roles and permissions' },

  // Products & Catalog
  { code: PERMISSIONS.PRODUCTS_CREATE, name: 'Create Product', module: 'Catalog', description: 'Can add products and variants' },
  { code: PERMISSIONS.PRODUCTS_READ, name: 'View Products', module: 'Catalog', description: 'Can view product catalog and prices' },
  { code: PERMISSIONS.PRODUCTS_UPDATE, name: 'Update Product', module: 'Catalog', description: 'Can edit products and prices' },
  { code: PERMISSIONS.PRODUCTS_DELETE, name: 'Delete Product', module: 'Catalog', description: 'Can remove products' },
  { code: PERMISSIONS.CATEGORIES_MANAGE, name: 'Manage Categories', module: 'Catalog', description: 'Can manage categories and brands' },
  { code: PERMISSIONS.BRANDS_MANAGE, name: 'Manage Brands', module: 'Catalog', description: 'Can manage apparel brands' },

  // Inventory & Barcodes
  { code: PERMISSIONS.INVENTORY_READ, name: 'View Inventory', module: 'Inventory', description: 'Can view stock balances and ledger' },
  { code: PERMISSIONS.INVENTORY_ADJUST, name: 'Adjust Stock', module: 'Inventory', description: 'Can create stock adjustments' },
  { code: PERMISSIONS.INVENTORY_TRANSFER, name: 'Transfer Stock', module: 'Inventory', description: 'Can send and receive branch stock transfers' },
  { code: PERMISSIONS.INVENTORY_STOCKTAKE, name: 'Conduct Stocktake', module: 'Inventory', description: 'Can perform physical stock counts' },
  { code: PERMISSIONS.STOCK_APPROVE, name: 'Approve Stock Adjustments', module: 'Inventory', description: 'Can approve stock adjustments and damage write-offs' },
  { code: PERMISSIONS.BARCODE_PRINT, name: 'Print Barcode', module: 'Inventory', description: 'Can print Code 128 barcode labels' },
  { code: PERMISSIONS.BARCODE_REPRINT, name: 'Reprint Barcode', module: 'Inventory', description: 'Can reprint barcode labels with audit reason' },

  // POS & Sales
  { code: PERMISSIONS.POS_ACCESS, name: 'Access POS', module: 'Sales', description: 'Can open and use the point-of-sale terminal' },
  { code: PERMISSIONS.SALES_CREATE, name: 'Create Sale', module: 'Sales', description: 'Can checkout and complete retail sales' },
  { code: PERMISSIONS.SALES_READ, name: 'View Sales', module: 'Sales', description: 'Can view sales history and invoices' },
  { code: PERMISSIONS.SALES_RETURN, name: 'Process Return', module: 'Sales', description: 'Can process sales returns and refunds' },
  { code: PERMISSIONS.SALES_EXCHANGE, name: 'Process Exchange', module: 'Sales', description: 'Can process garment size/color exchanges' },
  { code: PERMISSIONS.SALES_VOID, name: 'Void Sale', module: 'Sales', description: 'Can cancel or void sales invoices' },
  { code: PERMISSIONS.DUE_COLLECT, name: 'Collect Customer Due', module: 'Sales', description: 'Can collect customer credit/due payments' },

  // Purchasing
  { code: PERMISSIONS.PURCHASES_CREATE, name: 'Create Purchase', module: 'Purchasing', description: 'Can receive supplier stock purchases' },
  { code: PERMISSIONS.PURCHASES_READ, name: 'View Purchases', module: 'Purchasing', description: 'Can view purchase bills' },
  { code: PERMISSIONS.PURCHASES_RETURN, name: 'Return to Supplier', module: 'Purchasing', description: 'Can return damaged goods to supplier' },
  { code: PERMISSIONS.SUPPLIERS_MANAGE, name: 'Manage Suppliers', module: 'Purchasing', description: 'Can manage garment suppliers/factories' },

  // Cash Register
  { code: PERMISSIONS.CASH_REGISTER_OPEN_CLOSE, name: 'Open/Close Register', module: 'Cash', description: 'Can start and close cashier shifts' },
  { code: PERMISSIONS.CASH_REGISTER_VIEW, name: 'View Register Sessions', module: 'Cash', description: 'Can view shift cash logs' },
  { code: PERMISSIONS.CASH_MOVE, name: 'Cash In/Out', module: 'Cash', description: 'Can record cash drawer pay-in and pay-out' },

  // Expenses & Reports
  { code: PERMISSIONS.EXPENSES_CREATE, name: 'Create Expense', module: 'Expenses', description: 'Can record operational showroom expenses' },
  { code: PERMISSIONS.EXPENSES_READ, name: 'View Expenses', module: 'Expenses', description: 'Can view showroom expense records' },
  { code: PERMISSIONS.EXPENSES_DELETE, name: 'Delete Expense', module: 'Expenses', description: 'Can delete or void expense vouchers' },
  { code: PERMISSIONS.REPORTS_VIEW, name: 'View Reports', module: 'Reports', description: 'Can access daily sales and financial reports' },
];
