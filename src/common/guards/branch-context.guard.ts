import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { IS_OPTIONAL_BRANCH_KEY } from '../decorators/optional-branch.decorator.js';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import type { BranchContext } from '../decorators/current-branch.decorator.js';

@Injectable()
export class BranchContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const isOptionalBranch = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_BRANCH_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();
    const url = request.url || '';
    if (url.startsWith('/platform')) {
      return true;
    }

    const user = (request as any).user as AuthenticatedUser;

    if (!user) {
      return true; // If not authenticated yet (handled by JwtAuthGuard)
    }

    const branchIdHeader = request.headers['x-branch-id'];
    const branchId = Array.isArray(branchIdHeader) ? branchIdHeader[0] : branchIdHeader;

    if (!branchId) {
      if (isOptionalBranch) {
        return true;
      }
      throw new BadRequestException(
        'Missing required header: x-branch-id. Every operation must be scoped to an active branch.',
      );
    }

    // Verify branch exists and belongs to this business
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        business_id: user.businessId,
        deleted_at: null,
      },
    });

    if (!branch) {
      throw new NotFoundException(
        `Branch with ID "${branchId}" does not exist in your business.`,
      );
    }

    if (!branch.is_active) {
      throw new ForbiddenException(
        `Branch "${branch.name}" is currently inactive.`,
      );
    }

    // Business rule: Owner has access to all branches of their business
    if (user.isOwner) {
      const branchContext: BranchContext = {
        businessId: user.businessId,
        userId: user.id,
        branchId: branch.id,
        isAllBranchAdmin: true,
      };
      (request as any).branchContext = branchContext;
      return true;
    }

    // Standard user: Verify UserBranchAccess
    const access = await this.prisma.userBranchAccess.findFirst({
      where: {
        user_id: user.id,
        branch_id: branch.id,
        business_id: user.businessId,
      },
    });

    if (!access) {
      throw new ForbiddenException(
        `You do not have permission to act on branch "${branch.name}".`,
      );
    }

    const branchContext: BranchContext = {
      businessId: user.businessId,
      userId: user.id,
      branchId: branch.id,
      isAllBranchAdmin: false,
    };
    (request as any).branchContext = branchContext;

    return true;
  }
}
