import { SetMetadata } from '@nestjs/common';
import { SuperAdminRole } from '../../../generated/prisma/client.js';

export const PLATFORM_ROLES_KEY = 'platform_roles';
export const PlatformRoles = (...roles: SuperAdminRole[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);
