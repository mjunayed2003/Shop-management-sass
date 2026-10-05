import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_BRANCH_KEY = 'isOptionalBranch';
export const OptionalBranch = () => SetMetadata(IS_OPTIONAL_BRANCH_KEY, true);
