import { Injectable } from '@nestjs/common';
import type { Prisma, SequenceType } from '../../../generated/prisma/client.js';

@Injectable()
export class SequenceService {
  /**
   * Generates the next sequential invoice/document number inside a transaction.
   * Atomically increments `next_number` in `invoice_sequences` table.
   */
  async getNextNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
    branchId: string,
    sequenceType: SequenceType,
    customPrefix?: string,
  ): Promise<string> {
    const defaultPrefixes: Record<SequenceType, string> = {
      SALE_INVOICE: 'INV-',
      PURCHASE_INVOICE: 'PUR-',
      RETURN_INVOICE: 'RET-',
      TRANSFER_INVOICE: 'TRN-',
      JOURNAL_ENTRY: 'JE-',
      EXPENSE_VOUCHER: 'PAY-',
    };

    const targetPrefix = customPrefix || defaultPrefixes[sequenceType] || 'DOC-';

    const sequence = await tx.invoiceSequence.upsert({
      where: {
        business_id_branch_id_sequence_type: {
          business_id: businessId,
          branch_id: branchId,
          sequence_type: sequenceType,
        },
      },
      update: {
        next_number: { increment: 1 },
      },
      create: {
        business_id: businessId,
        branch_id: branchId,
        sequence_type: sequenceType,
        prefix: targetPrefix,
        next_number: 2, // returning 1
      },
    });

    const isNewlyCreated =
      sequence.created_at.getTime() === sequence.updated_at.getTime() &&
      sequence.next_number === 2;

    const num = isNewlyCreated ? 1 : sequence.next_number - 1;
    const prefix = customPrefix || sequence.prefix;

    return `${prefix}${String(num).padStart(6, '0')}`;
  }

  /**
   * Helper for business-level transfer number ensuring global uniqueness across branches.
   */
  async getNextTransferNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
    fromBranchId: string,
  ): Promise<string> {
    const rawNo = await this.getNextNumber(
      tx,
      businessId,
      fromBranchId,
      'TRANSFER_INVOICE',
      'TRN-',
    );
    return `${rawNo}-${fromBranchId.slice(0, 4).toUpperCase()}`;
  }
}
