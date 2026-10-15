import { Module } from '@nestjs/common';
import { RoleController } from './role.controller.js';
import { PermissionsController } from './permissions.controller.js';
import { RoleService } from './role.service.js';

@Module({
  controllers: [RoleController, PermissionsController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
