import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StockService } from './stock.service.js';
import { SequenceService } from './sequence.service.js';
import {
  CreateStockTransferDto,
  ReceiveTransferDto,
  StockTransferQueryDto,
  InstantTransferDto,
} from '../dto/stock-transfer.dto.js';
import { Prisma } from '../../../generated/prisma/client.js';

export interface InstantTransferParams {
  businessId: string;
  fromBranch: string;
  toBranch: string;
  items: Array<{ variantId: string; quantity: number | string }>;
  idempotencyKey?: string | null;
  notes?: string | null;
  createdBy: string;
}

@Injectable()
export class StockTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
  ) {}

  async createTransfer(
    businessId: string,
    fromBranchId: string,
    userId: string,
    dto: CreateStockTransferDto,
  ) {
    if (fromBranchId === dto.toBranchId) {
      throw new BadRequestException('Source and destination branches cannot be the same.');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one transfer item is required.');
    }

    // Verify destination branch exists and is active
    const toBranch = await this.prisma.branch.findFirst({
      where: { id: dto.toBranchId, business_id: businessId, deleted_at: null, is_active: true },
    });
    if (!toBranch) {
      throw new NotFoundException(`Destination branch with ID "${dto.toBranchId}" not found or inactive.`);
    }

    const fromBranch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: fromBranchId },
    });

    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, business_id: businessId, deleted_at: null },
    });
    if (variants.length !== variantIds.length) {
      throw new BadRequestException('One or more product variants were not found.');
    }

    return this.prisma.$transaction(async (tx) => {
      const transferNo = await this.sequenceService.getNextTransferNumber(
        tx,
        businessId,
        fromBranchId,
      );

      const transfer = await tx.stockTransfer.create({
        data: {
          business_id: businessId,
          from_branch_id: fromBranchId,
          to_branch_id: dto.toBranchId,
          transfer_no: transferNo,
          status: 'PENDING',
          notes: dto.notes?.trim() || null,
          items: {
            create: dto.items.map((i) => ({
              product_variant_id: i.variantId,
              sent_qty: new Prisma.Decimal(i.sentQty),
              received_qty: new Prisma.Decimal(0),
              unit_cost: new Prisma.Decimal(0), // Populated on dispatch from source WAC
            })),
          },
        },
        include: { items: true, from_branch: true, to_branch: true },
      });

      // Notify destination branch of incoming transfer request
      await tx.notification.create({
        data: {
          business_id: businessId,
          branch_id: dto.toBranchId,
          title: 'Stock Transfer Request',
          message: `Branch "${fromBranch.name}" created transfer ${transferNo} with ${dto.items.length} item(s).`,
          type: 'TRANSFER_REQUEST',
          is_read: false,
        },
      });

      return transfer;
    });
  }

  async dispatchTransfer(businessId: string, branchId: string, userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, business_id: businessId, from_branch_id: branchId },
      include: { items: true },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found.`);
    }

    if (transfer.status !== 'PENDING') {
      throw new BadRequestException(`Only PENDING transfers can be dispatched (current: ${transfer.status}).`);
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        // Stock-out from source branch at current source WAC
        const result = await this.stockService.applyMovement(tx, {
          businessId,
          branchId,
          variantId: item.product_variant_id,
          movementType: 'TRANSFER_OUT',
          quantity: item.sent_qty,
          referenceType: 'TRANSFER',
          referenceId: transfer.id,
          createdBy: userId,
          remarks: `Transfer ${transfer.transfer_no} dispatched`,
        });

        // Set item unit_cost to source WAC
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { unit_cost: result.newWac },
        });

        // Check if individually tracked units need status = IN_TRANSIT
        const trackedUnits = await tx.productUnit.findMany({
          where: {
            business_id: businessId,
            branch_id: branchId,
            product_variant_id: item.product_variant_id,
            status: 'IN_STOCK',
          },
          take: Number(item.sent_qty),
        });

        if (trackedUnits.length > 0) {
          await tx.productUnit.updateMany({
            where: { id: { in: trackedUnits.map((u) => u.id) } },
            data: { status: 'IN_TRANSIT' },
          });
        }
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'IN_TRANSIT',
          dispatched_at: new Date(),
          dispatched_by: userId,
        },
        include: { items: true },
      });
    });
  }

  async receiveTransfer(
    businessId: string,
    destinationBranchId: string,
    userId: string,
    id: string,
    dto: ReceiveTransferDto,
  ) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, business_id: businessId },
      include: { items: true },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found.`);
    }

    if (transfer.to_branch_id !== destinationBranchId) {
      throw new ForbiddenException('You can only receive transfers addressed to your current branch.');
    }

    if (transfer.status !== 'IN_TRANSIT') {
      throw new BadRequestException(`Only IN_TRANSIT transfers can be received (current: ${transfer.status}).`);
    }

    const itemReceiptMap = new Map(dto.items.map((i) => [i.itemId, i]));

    return this.prisma.$transaction(async (tx) => {
      let discrepancyNotes = transfer.notes || '';

      for (const item of transfer.items) {
        const receipt = itemReceiptMap.get(item.id);
        const receivedQty = receipt !== undefined
          ? new Prisma.Decimal(receipt.receivedQty)
          : new Prisma.Decimal(item.sent_qty);

        if (receivedQty.lessThan(0) || receivedQty.greaterThan(new Prisma.Decimal(item.sent_qty))) {
          throw new BadRequestException(
            `Received quantity cannot be negative or exceed sent quantity (${item.sent_qty.toString()}).`,
          );
        }

        // Record discrepancy note if received less than sent
        if (receivedQty.lessThan(new Prisma.Decimal(item.sent_qty))) {
          const diff = new Prisma.Decimal(item.sent_qty).minus(receivedQty);
          const note = receipt?.discrepancyNote || 'Shortage during transfer';
          discrepancyNotes += ` [Shortage: variant ${item.product_variant_id} sent ${item.sent_qty}, received ${receivedQty} (diff ${diff}): ${note}]`;
        }

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { received_qty: receivedQty },
        });

        // Stock-in to destination branch at transfer unit_cost (recalculates destination WAC!)
        if (receivedQty.greaterThan(0)) {
          await this.stockService.applyMovement(tx, {
            businessId,
            branchId: destinationBranchId,
            variantId: item.product_variant_id,
            movementType: 'TRANSFER_IN',
            quantity: receivedQty,
            unitCost: item.unit_cost,
            referenceType: 'TRANSFER',
            referenceId: transfer.id,
            createdBy: userId,
            remarks: `Transfer ${transfer.transfer_no} received`,
          });
        }

        // Move tracked ProductUnits to destination branch
        const inTransitUnits = await tx.productUnit.findMany({
          where: {
            business_id: businessId,
            branch_id: transfer.from_branch_id,
            product_variant_id: item.product_variant_id,
            status: 'IN_TRANSIT',
          },
          take: receivedQty.toNumber(),
        });

        if (inTransitUnits.length > 0) {
          await tx.productUnit.updateMany({
            where: { id: { in: inTransitUnits.map((u) => u.id) } },
            data: {
              branch_id: destinationBranchId,
              status: 'IN_STOCK',
            },
          });
        }
      }

      return tx.stockTransfer.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          received_at: new Date(),
          received_by: userId,
          notes: discrepancyNotes.trim() || null,
        },
        include: { items: true },
      });
    });
  }

  async rejectTransfer(businessId: string, branchId: string, userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, business_id: businessId },
      include: { items: true },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found.`);
    }

    if (transfer.status === 'RECEIVED' || transfer.status === 'REJECTED' || transfer.status === 'CANCELLED') {
      throw new BadRequestException(`Transfer cannot be rejected with status "${transfer.status}".`);
    }

    return this.prisma.$transaction(async (tx) => {
      // If already dispatched, return stock back to source branch
      if (transfer.status === 'IN_TRANSIT') {
        for (const item of transfer.items) {
          await this.stockService.applyMovement(tx, {
            businessId,
            branchId: transfer.from_branch_id,
            variantId: item.product_variant_id,
            movementType: 'TRANSFER_IN',
            quantity: item.sent_qty,
            unitCost: item.unit_cost,
            referenceType: 'TRANSFER',
            referenceId: transfer.id,
            createdBy: userId,
            remarks: `Transfer ${transfer.transfer_no} rejected - returned to source`,
          });

          // Reset IN_TRANSIT units back to IN_STOCK at source
          await tx.productUnit.updateMany({
            where: {
              business_id: businessId,
              branch_id: transfer.from_branch_id,
              product_variant_id: item.product_variant_id,
              status: 'IN_TRANSIT',
            },
            data: { status: 'IN_STOCK' },
          });
        }
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: 'REJECTED' },
      });
    });
  }

  async cancelTransfer(businessId: string, branchId: string, userId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, business_id: businessId, from_branch_id: branchId },
      include: { items: true },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found.`);
    }

    if (transfer.status === 'RECEIVED' || transfer.status === 'CANCELLED') {
      throw new BadRequestException(`Transfer cannot be cancelled with status "${transfer.status}".`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (transfer.status === 'IN_TRANSIT') {
        for (const item of transfer.items) {
          await this.stockService.applyMovement(tx, {
            businessId,
            branchId: transfer.from_branch_id,
            variantId: item.product_variant_id,
            movementType: 'TRANSFER_IN',
            quantity: item.sent_qty,
            unitCost: item.unit_cost,
            referenceType: 'TRANSFER',
            referenceId: transfer.id,
            createdBy: userId,
            remarks: `Transfer ${transfer.transfer_no} cancelled - returned to source`,
          });

          await tx.productUnit.updateMany({
            where: {
              business_id: businessId,
              branch_id: transfer.from_branch_id,
              product_variant_id: item.product_variant_id,
              status: 'IN_TRANSIT',
            },
            data: { status: 'IN_STOCK' },
          });
        }
      }

      return tx.stockTransfer.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });
  }

  /**
   * Internal service method: executes dispatch + receive in one go (status RECEIVED).
   * Fully idempotent using StockTransfer.idempotency_key.
   * Phase 4 cross-branch auto-transfer will call this.
   */
  async createInstantTransfer(
    tx: Prisma.TransactionClient,
    params: InstantTransferParams,
  ) {
    // 1. Idempotency Check
    if (params.idempotencyKey) {
      const existing = await tx.stockTransfer.findUnique({
        where: {
          business_id_idempotency_key: {
            business_id: params.businessId,
            idempotency_key: params.idempotencyKey,
          },
        },
        include: { items: true },
      });

      if (existing) {
        return existing;
      }
    }

    const transferNo = await this.sequenceService.getNextTransferNumber(
      tx,
      params.businessId,
      params.fromBranch,
    );

    const now = new Date();

    const transfer = await tx.stockTransfer.create({
      data: {
        business_id: params.businessId,
        from_branch_id: params.fromBranch,
        to_branch_id: params.toBranch,
        transfer_no: transferNo,
        idempotency_key: params.idempotencyKey || null,
        status: 'RECEIVED',
        dispatched_at: now,
        received_at: now,
        dispatched_by: params.createdBy,
        received_by: params.createdBy,
        notes: params.notes?.trim() || 'Instant transfer',
      },
    });

    for (const item of params.items) {
      const qty = new Prisma.Decimal(item.quantity);

      // Stock-out from source
      const outResult = await this.stockService.applyMovement(tx, {
        businessId: params.businessId,
        branchId: params.fromBranch,
        variantId: item.variantId,
        movementType: 'TRANSFER_OUT',
        quantity: qty,
        referenceType: 'TRANSFER',
        referenceId: transfer.id,
        createdBy: params.createdBy,
        remarks: `Instant transfer ${transferNo} (out)`,
      });

      // Stock-in to destination
      await this.stockService.applyMovement(tx, {
        businessId: params.businessId,
        branchId: params.toBranch,
        variantId: item.variantId,
        movementType: 'TRANSFER_IN',
        quantity: qty,
        unitCost: outResult.newWac,
        referenceType: 'TRANSFER',
        referenceId: transfer.id,
        createdBy: params.createdBy,
        remarks: `Instant transfer ${transferNo} (in)`,
      });

      // Create item record
      await tx.stockTransferItem.create({
        data: {
          transfer_id: transfer.id,
          product_variant_id: item.variantId,
          sent_qty: qty,
          received_qty: qty,
          unit_cost: outResult.newWac,
        },
      });

      // Move tracked units
      const trackedUnits = await tx.productUnit.findMany({
        where: {
          business_id: params.businessId,
          branch_id: params.fromBranch,
          product_variant_id: item.variantId,
          status: 'IN_STOCK',
        },
        take: qty.toNumber(),
      });

      if (trackedUnits.length > 0) {
        await tx.productUnit.updateMany({
          where: { id: { in: trackedUnits.map((u) => u.id) } },
          data: {
            branch_id: params.toBranch,
            status: 'IN_STOCK',
          },
        });
      }
    }

    return tx.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: { items: true },
    });
  }

  async instantTransferEndpoint(
    businessId: string,
    userId: string,
    dto: InstantTransferDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      return this.createInstantTransfer(tx, {
        businessId,
        fromBranch: dto.fromBranchId,
        toBranch: dto.toBranchId,
        items: dto.items,
        idempotencyKey: dto.idempotencyKey,
        notes: dto.notes,
        createdBy: userId,
      });
    });
  }

  async listTransfers(
    businessId: string,
    branchId: string,
    query: StockTransferQueryDto,
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.StockTransferWhereInput = {
      business_id: businessId,
      OR: [{ from_branch_id: branchId }, { to_branch_id: branchId }],
      ...(query.status && { status: query.status }),
      ...(query.search && { transfer_no: { contains: query.search, mode: 'insensitive' } }),
    };

    const [total, transfers] = await Promise.all([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          from_branch: { select: { id: true, name: true, code: true } },
          to_branch: { select: { id: true, name: true, code: true } },
          items: {
            include: {
              variant: { select: { sku: true, barcode: true, product: { select: { name: true } } } },
            },
          },
        },
      }),
    ]);

    return {
      data: transfers,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTransferById(businessId: string, id: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, business_id: businessId },
      include: {
        from_branch: true,
        to_branch: true,
        items: {
          include: {
            variant: {
              include: {
                product: true,
                size: true,
                color: true,
              },
            },
          },
        },
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found.`);
    }

    return transfer;
  }
}
