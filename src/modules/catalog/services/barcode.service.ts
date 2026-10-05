import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PrintBarcodeDto } from '../dto/barcode.dto.js';

@Injectable()
export class BarcodeService {
  constructor(private readonly prisma: PrismaService) {}

  async printBarcode(
    businessId: string,
    branchId: string,
    userId: string,
    dto: PrintBarcodeDto,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: dto.variantId,
        business_id: businessId,
        deleted_at: null,
      },
      include: {
        product: { select: { id: true, name: true, code: true, currency: false } },
        size: { select: { id: true, name: true, code: true } },
        color: { select: { id: true, name: true, code: true } },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Product variant with ID "${dto.variantId}" not found.`);
    }

    if (dto.printType === 'REPRINT' && !dto.reason?.trim()) {
      throw new BadRequestException('A reason must be provided when reprinting barcode labels.');
    }

    const log = await this.prisma.barcodePrintLog.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        product_variant_id: variant.id,
        product_unit_id: dto.productUnitId || null,
        barcode_value: variant.barcode,
        print_type: dto.printType,
        reason: dto.reason?.trim() || null,
        printed_by: userId,
        quantity_printed: dto.quantity,
        label_format: 'CODE_128',
      },
    });

    return {
      message: 'Barcode print logged successfully.',
      printLogId: log.id,
      label: {
        productName: variant.product.name,
        productCode: variant.product.code,
        sku: variant.sku,
        size: variant.size?.name || null,
        color: variant.color?.name || null,
        retailPrice: Number(variant.retail_price),
        currency: 'BDT',
        barcode: variant.barcode,
        format: 'CODE_128',
        quantity: dto.quantity,
        printType: dto.printType,
      },
    };
  }

  async lookupBarcode(
    businessId: string,
    currentBranchId: string,
    barcode: string,
  ) {
    const cleanBarcode = barcode.trim();

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        barcode: cleanBarcode,
        business_id: businessId,
        deleted_at: null,
      },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            unit: true,
            branches: {
              where: { is_active: true },
              include: { branch: true },
            },
          },
        },
        size: true,
        color: true,
        stock_balances: {
          where: { business_id: businessId },
          include: { branch: { select: { id: true, name: true, code: true } } },
        },
      },
    });

    if (!variant || variant.product.deleted_at !== null) {
      throw new NotFoundException(`No product found with barcode "${cleanBarcode}".`);
    }

    // Check if product is active in the requesting branch
    const isActiveInCurrentBranch = variant.product.branches.some(
      (pb) => pb.branch_id === currentBranchId && pb.is_active,
    );

    const currentBranchStockRecord = variant.stock_balances.find(
      (sb) => sb.branch_id === currentBranchId,
    );
    const currentBranchStock = Number(currentBranchStockRecord?.quantity || 0);

    // CASE 1: Product IS ACTIVE in the current branch
    if (isActiveInCurrentBranch) {
      return {
        found: true,
        activeInCurrentBranch: true,
        product: {
          id: variant.product.id,
          name: variant.product.name,
          code: variant.product.code,
          category: variant.product.category,
          brand: variant.product.brand,
          unit: variant.product.unit,
        },
        variant: {
          id: variant.id,
          sku: variant.sku,
          barcode: variant.barcode,
          retailPrice: Number(variant.retail_price),
          wholesalePrice: Number(variant.wholesale_price),
          costPrice: Number(variant.cost_price),
          reorderLevel: variant.reorder_level,
          size: variant.size,
          color: variant.color,
          stock: currentBranchStock,
        },
      };
    }

    // CASE 2: Product EXISTS in business, but NOT ACTIVE in this branch
    const otherBranchesStock = variant.product.branches
      .filter((pb) => pb.branch_id !== currentBranchId && pb.is_active)
      .map((pb) => {
        const sb = variant.stock_balances.find((s) => s.branch_id === pb.branch_id);
        return {
          branchId: pb.branch_id,
          branchName: pb.branch.name,
          branchCode: pb.branch.code,
          stock: Number(sb?.quantity || 0),
        };
      });

    return {
      found: true,
      activeInCurrentBranch: false,
      code: 'PRODUCT_IN_OTHER_BRANCH',
      message:
        'This product exists in your business catalog but is not assigned or active in this branch.',
      product: {
        id: variant.product.id,
        name: variant.product.name,
        code: variant.product.code,
        category: variant.product.category,
        brand: variant.product.brand,
        unit: variant.product.unit,
      },
      variant: {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        retailPrice: Number(variant.retail_price),
        size: variant.size,
        color: variant.color,
      },
      availableBranches: otherBranchesStock,
    };
  }
}
