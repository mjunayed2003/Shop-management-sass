import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  OpenRegisterSessionDto,
  CreateCashMovementDto,
  CloseRegisterSessionDto,
  CashBookQueryDto,
} from '../dto/register-session.dto.js';
import { Prisma, CashMovementType } from '../../../generated/prisma/client.js';

export interface UserRoleContext {
  code: string;
  name: string;
  permissions: string[];
}

@Injectable()
export class RegisterSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Opens a new cash register session for the current cashier in the active branch.
   * Enforces:
   * 1. One OPEN session per cash register.
   * 2. One OPEN session per cashier user.
   */
  async openSession(
    businessId: string,
    branchId: string,
    userId: string,
    dto: OpenRegisterSessionDto,
  ) {
    const register = await this.prisma.cashRegister.findFirst({
      where: {
        id: dto.cashRegisterId,
        business_id: businessId,
        branch_id: branchId,
        is_active: true,
      },
    });

    if (!register) {
      throw new NotFoundException(
        `Active cash register with ID "${dto.cashRegisterId}" not found in this branch.`,
      );
    }

    // 1. Check if register already has an active open session
    const registerOpenSession = await this.prisma.registerSession.findFirst({
      where: {
        business_id: businessId,
        cash_register_id: dto.cashRegisterId,
        status: 'OPEN',
      },
    });

    if (registerOpenSession) {
      throw new ConflictException(
        `Cash register "${register.name}" (${register.code}) already has an open session.`,
      );
    }

    // 2. Check if user already has an active open session in this branch
    const userOpenSession = await this.prisma.registerSession.findFirst({
      where: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        status: 'OPEN',
      },
    });

    if (userOpenSession) {
      throw new ConflictException(
        `You already have an open register session in this branch (Session ID: ${userOpenSession.id}).`,
      );
    }

    const openingBalance = new Prisma.Decimal(dto.openingBalance || 0);

    return this.prisma.registerSession.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        cash_register_id: register.id,
        user_id: userId,
        opening_balance: openingBalance,
        status: 'OPEN',
        opened_at: new Date(),
      },
      include: {
        cash_register: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  /**
   * Retrieves the current cashier's active open session in the active branch.
   */
  async getCurrentSession(businessId: string, branchId: string, userId: string) {
    const session = await this.prisma.registerSession.findFirst({
      where: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        status: 'OPEN',
      },
      include: {
        cash_register: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(
        'No active open register session found for current user in this branch.',
      );
    }

    return session;
  }

  /**
   * Validates if a session exists and is OPEN.
   */
  async validateActiveSession(
    businessId: string,
    branchId: string,
    userId: string,
    sessionId?: string,
  ) {
    if (sessionId) {
      const session = await this.prisma.registerSession.findFirst({
        where: {
          id: sessionId,
          business_id: businessId,
          branch_id: branchId,
          status: 'OPEN',
        },
      });

      if (!session) {
        throw new BadRequestException(
          `Register session "${sessionId}" is not open or does not belong to this branch.`,
        );
      }
      return session;
    }

    // Fallback: look up user's active session in this branch
    const session = await this.prisma.registerSession.findFirst({
      where: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        status: 'OPEN',
      },
    });

    if (!session) {
      throw new BadRequestException(
        'An open register session is required before creating transactions. Please open a session first.',
      );
    }

    return session;
  }

  /**
   * Records a manual drawer Cash Movement (PAY_IN or PAY_OUT).
   * PAY_OUT cannot exceed current drawer cash.
   */
  async createCashMovement(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CreateCashMovementDto,
  ) {
    const session = await this.validateActiveSession(
      businessId,
      branchId,
      userId,
      dto.registerSessionId,
    );

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Cash movement amount must be greater than zero.');
    }

    // If PAY_OUT, compute live expected drawer cash
    if (dto.type === CashMovementType.PAY_OUT) {
      const summary = await this.calculateSessionSummary(session.id);
      const availableCash = new Prisma.Decimal(summary.expected_balance);

      if (amount.greaterThan(availableCash)) {
        throw new BadRequestException(
          `Cash pay-out amount (BDT ${amount.toString()}) exceeds current drawer cash (Available: BDT ${availableCash.toString()}).`,
        );
      }
    }

    const movement = await this.prisma.cashMovement.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        register_session_id: session.id,
        type: dto.type,
        amount,
        reason: dto.reason.trim(),
        performed_by: userId,
      },
    });

    // Write AuditLog
    await this.prisma.auditLog.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        action: 'CREATE',
        entity_table: 'cash_movements',
        entity_id: movement.id,
        new_values: {
          type: dto.type,
          amount: amount.toString(),
          reason: dto.reason,
          register_session_id: session.id,
        },
      },
    });

    return movement;
  }

  /**
   * Internal calculator for live expected drawer cash & session metrics.
   */
  async calculateSessionSummary(sessionId: string) {
    const session = await this.prisma.registerSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        cash_register: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    const openingBalance = new Prisma.Decimal(session.opening_balance);

    // 1. Cash Sales & Non-Cash payments
    const payments = await this.prisma.salePayment.findMany({
      where: { register_session_id: sessionId },
    });

    let cashSales = new Prisma.Decimal(0);
    const nonCashMap: Record<string, Prisma.Decimal> = {
      BKASH: new Prisma.Decimal(0),
      NAGAD: new Prisma.Decimal(0),
      BANK: new Prisma.Decimal(0),
      CARDS: new Prisma.Decimal(0),
      CHEQUE: new Prisma.Decimal(0),
    };

    for (const p of payments) {
      const amt = new Prisma.Decimal(p.amount);
      if (p.payment_method === 'CASH') {
        cashSales = cashSales.plus(amt);
      } else {
        const method = p.payment_method;
        nonCashMap[method] = (nonCashMap[method] || new Prisma.Decimal(0)).plus(amt);
      }
    }

    // 2. Cash Due Collections
    const dueCollections = await this.prisma.dueCollection.findMany({
      where: { register_session_id: sessionId },
    });

    let cashDueCollections = new Prisma.Decimal(0);
    for (const dc of dueCollections) {
      const amt = new Prisma.Decimal(dc.amount);
      if (dc.payment_method === 'CASH') {
        cashDueCollections = cashDueCollections.plus(amt);
      } else {
        const method = dc.payment_method;
        nonCashMap[method] = (nonCashMap[method] || new Prisma.Decimal(0)).plus(amt);
      }
    }

    // 3. Cash Movements (PAY_IN / PAY_OUT)
    const movements = await this.prisma.cashMovement.findMany({
      where: { register_session_id: sessionId },
    });

    let payIns = new Prisma.Decimal(0);
    let payOuts = new Prisma.Decimal(0);

    for (const m of movements) {
      const amt = new Prisma.Decimal(m.amount);
      if (m.type === 'PAY_IN') {
        payIns = payIns.plus(amt);
      } else if (m.type === 'PAY_OUT') {
        payOuts = payOuts.plus(amt);
      }
    }

    // 4. Cash Refunds (Sales returns paid out in CASH)
    const returns = await this.prisma.salesReturn.findMany({
      where: {
        register_session_id: sessionId,
      },
    });

    let cashRefunds = new Prisma.Decimal(0);
    for (const ret of returns) {
      if (ret.refund_method === 'CASH') {
        cashRefunds = cashRefunds.plus(new Prisma.Decimal(ret.total_refund_amount));
      }
    }

    // 5. Cash Exchange Refunds (where shop refunded difference back)
    const exchangeRefunds = await this.prisma.exchange.findMany({
      where: {
        sales_return: {
          register_session_id: sessionId,
        },
        adjustment_status: 'SHOP_REFUNDED',
      },
    });

    let cashExchangeRefunds = new Prisma.Decimal(0);
    for (const exc of exchangeRefunds) {
      const diff = new Prisma.Decimal(exc.difference_amount).abs();
      cashExchangeRefunds = cashExchangeRefunds.plus(diff);
    }

    const totalCashRefunds = cashRefunds.plus(cashExchangeRefunds);

    // 6. Cash Expenses paid from register
    const expenses = await this.prisma.expense.findMany({
      where: { register_session_id: sessionId },
    });

    let cashExpenses = new Prisma.Decimal(0);
    for (const exp of expenses) {
      cashExpenses = cashExpenses.plus(new Prisma.Decimal(exp.total_amount));
    }

    // 7. Expected Balance Formula:
    // opening + cashSales + cashDue + payIns - payOuts - refunds - expenses
    const expectedBalance = openingBalance
      .plus(cashSales)
      .plus(cashDueCollections)
      .plus(payIns)
      .minus(payOuts)
      .minus(totalCashRefunds)
      .minus(cashExpenses);

    // 8. Counts
    const [salesCount, voidsCount] = await Promise.all([
      this.prisma.sale.count({
        where: {
          register_session_id: sessionId,
          status: { not: 'VOIDED' },
        },
      }),
      this.prisma.sale.count({
        where: {
          register_session_id: sessionId,
          status: 'VOIDED',
        },
      }),
    ]);

    return {
      session,
      opening_balance: openingBalance.toString(),
      cash_sales: cashSales.toString(),
      cash_due_collections: cashDueCollections.toString(),
      pay_ins: payIns.toString(),
      pay_outs: payOuts.toString(),
      cash_refunds: totalCashRefunds.toString(),
      cash_expenses: cashExpenses.toString(),
      expected_balance: expectedBalance.toString(),
      non_cash_totals: Object.fromEntries(
        Object.entries(nonCashMap).map(([k, v]) => [k, v.toString()]),
      ),
      sales_count: salesCount,
      returns_count: returns.length,
      voids_count: voidsCount,
    };
  }

  /**
   * Live X Report: non-mutating session summary.
   */
  async getSessionSummary(
    businessId: string,
    branchId: string,
    userId: string,
    sessionId?: string,
    isAllBranchAdmin: boolean = false,
  ) {
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const current = await this.getCurrentSession(businessId, branchId, userId);
      targetSessionId = current.id;
    }

    const session = await this.prisma.registerSession.findFirst({
      where: {
        id: targetSessionId,
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
      },
    });

    if (!session) {
      throw new NotFoundException(`Register session "${targetSessionId}" not found in this branch.`);
    }

    return this.calculateSessionSummary(session.id);
  }

  /**
   * Closes a cash register session (Z report).
   * Computes expected balance & discrepancy.
   * Enforces discrepancy notes threshold and managers alert.
   * Prevents closing if unsynced offline sales exist.
   */
  async closeSession(
    businessId: string,
    branchId: string,
    userId: string,
    dto: CloseRegisterSessionDto,
    userRole?: UserRoleContext,
  ) {
    let targetSessionId = dto.registerSessionId;
    if (!targetSessionId) {
      const current = await this.getCurrentSession(businessId, branchId, userId);
      targetSessionId = current.id;
    }

    const session = await this.prisma.registerSession.findFirst({
      where: {
        id: targetSessionId,
        business_id: businessId,
        branch_id: branchId,
      },
      include: {
        user: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    if (!session) {
      throw new NotFoundException(`Register session "${targetSessionId}" not found in this branch.`);
    }

    if (session.status === 'CLOSED') {
      throw new BadRequestException('This register session is already closed.');
    }

    // Permission check: closing own session needs register.close; closing another's session needs register.close_any
    const isClosingOwn = session.user_id === userId;
    if (!isClosingOwn) {
      const hasCloseAnyPerm =
        userRole?.permissions.includes('*') ||
        userRole?.permissions.includes('register.close_any') ||
        userRole?.permissions.includes('register:close_any');

      if (!hasCloseAnyPerm) {
        throw new ForbiddenException(
          'Closing another user\'s register session requires "register.close_any" permission.',
        );
      }
    } else {
      const hasClosePerm =
        userRole?.permissions.includes('*') ||
        userRole?.permissions.includes('register.close') ||
        userRole?.permissions.includes('register:close') ||
        userRole?.permissions.includes('cash_register:open_close') ||
        userRole?.permissions.includes('cash_register.open_close');

      if (!hasClosePerm) {
        throw new ForbiddenException(
          'Closing register session requires "register.close" permission.',
        );
      }
    }

    // Check for inconsistent / unsynced offline sales
    const unsyncedSales = await this.prisma.sale.findMany({
      where: {
        register_session_id: session.id,
        is_offline: true,
        synced_at: null,
      },
      select: { invoice_no: true },
    });

    if (unsyncedSales.length > 0) {
      throw new BadRequestException(
        `Cannot close session with unsynced offline sales: [${unsyncedSales.map((s) => s.invoice_no).join(', ')}]. Sync sales first.`,
      );
    }

    // Compute live expected drawer balance
    const summary = await this.calculateSessionSummary(session.id);
    const expectedBalance = new Prisma.Decimal(summary.expected_balance);
    const closingBalance = new Prisma.Decimal(dto.closingBalance);
    const discrepancy = closingBalance.minus(expectedBalance);

    // Discrepancy threshold check (from settings or 0)
    const thresholdSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'discrepancy_threshold' },
    });
    const discrepancyThreshold = thresholdSetting
      ? Number(thresholdSetting.value)
      : 0;

    if (discrepancy.abs().greaterThan(discrepancyThreshold)) {
      if (!dto.closingNotes || dto.closingNotes.trim().length === 0) {
        throw new BadRequestException(
          `Closing notes are required when there is a cash discrepancy (Discrepancy: BDT ${discrepancy.toString()}).`,
        );
      }

      // Notify branch managers/admins
      await this.prisma.notification.create({
        data: {
          business_id: businessId,
          branch_id: branchId,
          type: 'SYSTEM_ALERT',
          title: 'Register Discrepancy Alert',
          message: `Shift closed by ${session.user.first_name} ${session.user.last_name} with discrepancy of BDT ${discrepancy.toString()} (Counted: ${closingBalance.toString()}, Expected: ${expectedBalance.toString()}). Notes: ${dto.closingNotes}`,
        },
      });
    }

    // Update Session to CLOSED
    const closedSession = await this.prisma.registerSession.update({
      where: { id: session.id },
      data: {
        closing_balance: closingBalance,
        expected_balance: expectedBalance,
        discrepancy,
        closing_notes: dto.closingNotes || null,
        status: 'CLOSED',
        closed_at: new Date(),
      },
      include: {
        cash_register: true,
        user: true,
      },
    });

    // Write AuditLog
    await this.prisma.auditLog.create({
      data: {
        business_id: businessId,
        branch_id: branchId,
        user_id: userId,
        action: 'UPDATE',
        entity_table: 'register_sessions',
        entity_id: session.id,
        new_values: {
          status: 'CLOSED',
          closing_balance: closingBalance.toString(),
          expected_balance: expectedBalance.toString(),
          discrepancy: discrepancy.toString(),
          closing_notes: dto.closingNotes,
        },
      },
    });

    return {
      session: closedSession,
      zReport: {
        ...summary,
        closing_balance: closingBalance.toString(),
        discrepancy: discrepancy.toString(),
        closed_at: closedSession.closed_at,
      },
    };
  }

  /**
   * Lists cash movements for a session or branch.
   */
  async getCashMovements(
    businessId: string,
    branchId: string,
    sessionId?: string,
    isAllBranchAdmin: boolean = false,
  ) {
    return this.prisma.cashMovement.findMany({
      where: {
        business_id: businessId,
        ...(isAllBranchAdmin ? {} : { branch_id: branchId }),
        ...(sessionId ? { register_session_id: sessionId } : {}),
      },
      orderBy: { created_at: 'desc' },
      include: {
        register_session: {
          select: {
            id: true,
            user: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });
  }

  /**
   * Daily Branch Cash Book: all sessions of a day with expected, counted, discrepancy per cashier.
   */
  async getDailyCashBook(
    businessId: string,
    currentBranchId: string,
    query: CashBookQueryDto,
    isAllBranchAdmin: boolean = false,
  ) {
    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const targetBranchId = isAllBranchAdmin && query.branchId ? query.branchId : currentBranchId;

    const sessions = await this.prisma.registerSession.findMany({
      where: {
        business_id: businessId,
        ...(isAllBranchAdmin && !query.branchId ? {} : { branch_id: targetBranchId }),
        opened_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        user: { select: { id: true, first_name: true, last_name: true } },
        cash_register: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { opened_at: 'asc' },
    });

    const entries = await Promise.all(
      sessions.map(async (sess) => {
        if (sess.status === 'CLOSED') {
          return {
            sessionId: sess.id,
            branch: sess.branch,
            cashier: `${sess.user.first_name} ${sess.user.last_name}`,
            register: sess.cash_register.name,
            status: sess.status,
            openedAt: sess.opened_at,
            closedAt: sess.closed_at,
            openingBalance: sess.opening_balance.toString(),
            expectedBalance: sess.expected_balance?.toString() || '0',
            closingBalance: sess.closing_balance?.toString() || '0',
            discrepancy: sess.discrepancy?.toString() || '0',
            closingNotes: sess.closing_notes,
          };
        }

        // Live open session
        const live = await this.calculateSessionSummary(sess.id);
        return {
          sessionId: sess.id,
          branch: sess.branch,
          cashier: `${sess.user.first_name} ${sess.user.last_name}`,
          register: sess.cash_register.name,
          status: sess.status,
          openedAt: sess.opened_at,
          closedAt: null,
          openingBalance: sess.opening_balance.toString(),
          expectedBalance: live.expected_balance,
          closingBalance: null,
          discrepancy: null,
          closingNotes: null,
        };
      }),
    );

    return {
      date: startOfDay.toISOString().split('T')[0],
      sessionsCount: entries.length,
      entries,
    };
  }
}
