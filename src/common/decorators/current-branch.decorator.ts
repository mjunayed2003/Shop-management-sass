import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface BranchContext {
  businessId: string;
  userId: string;
  branchId: string;
  isAllBranchAdmin: boolean;
}

export const CurrentBranch = createParamDecorator(
  (data: keyof BranchContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const branchContext = request.branchContext as BranchContext;
    return data ? branchContext?.[data] : branchContext;
  },
);
