import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { OnboardingService } from './onboarding.service.js';
import { OnboardBusinessDto } from './dto/onboard-business.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';

@ApiTags('Onboarding')
@Controller('api/v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Onboard new clothing retail business (Single Transaction)',
    description:
      'Creates business, 30-day trial subscription, main branch, owner account, default roles with permissions, initial branch cash register, invoice sequences, and garment master data (units, sizes, colors, expense categories).',
  })
  @ApiResponse({
    status: 201,
    description: 'Business successfully created and owner logged in with JWT',
  })
  @ApiResponse({ status: 400, description: 'Invalid input or missing plan/permissions' })
  @ApiResponse({ status: 409, description: 'Business slug already taken' })
  async onboard(@Body() dto: OnboardBusinessDto, @Req() req: Request) {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.onboardingService.onboard(dto, ipAddress, userAgent);
  }
}
