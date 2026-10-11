import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, SellerContext } from '../common/auth-user';
import { AllowPendingSeller, CurrentSeller, CurrentUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { SellerGuard } from '../common/guards/seller.guard';
import { UPLOAD_LIMITS } from '../storage/file-validation';
import { AdminSellersService } from './admin-sellers.service';
import {
  AdminListSellersQuery, ApplySellerDto, ReasonDto, ReviewDocumentDto, UpdateBankDto, UpdateSellerProfileDto, UploadDocumentDto,
} from './dto/seller.dto';
import { SellerOnboardingService } from './seller-onboarding.service';

@ApiTags('Seller / Onboarding')
@ApiBearerAuth()
@Controller({ path: 'seller', version: '1' })
export class SellerApplyController {
  constructor(private readonly onboarding: SellerOnboardingService) {}

  /** Any logged-in user. After this, call POST /auth/refresh to get the SELLER role in the token. */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('apply')
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplySellerDto) {
    return this.onboarding.apply(user.id, dto);
  }
}

@ApiTags('Seller / Account')
@ApiBearerAuth()
@UseGuards(SellerGuard)
@AllowPendingSeller() // everything here is needed during onboarding too
@Controller({ path: 'seller/me', version: '1' })
export class SellerAccountController {
  constructor(private readonly onboarding: SellerOnboardingService) {}

  @Get() me(@CurrentSeller() s: SellerContext) {
    return this.onboarding.getMine(s.id);
  }

  @Patch() update(@CurrentSeller() s: SellerContext, @Body() dto: UpdateSellerProfileDto, @CurrentUser() u: AuthUser) {
    return this.onboarding.updateProfile(s, dto, u.id);
  }

  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Put('bank') bank(@CurrentSeller() s: SellerContext, @Body() dto: UpdateBankDto, @CurrentUser() u: AuthUser) {
    return this.onboarding.updateBank(s, dto, u.id);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.document, files: 1 } }))
  @Post('documents')
  document(@CurrentSeller() s: SellerContext, @Body() dto: UploadDocumentDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser) {
    return this.onboarding.uploadDocument(s, dto.type, file, u.id);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('logo')
  logo(@CurrentSeller() s: SellerContext, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser) {
    return this.onboarding.uploadStoreImage(s, 'logo', file, u.id);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.image, files: 1 } }))
  @Post('banner')
  banner(@CurrentSeller() s: SellerContext, @UploadedFile() file: Express.Multer.File, @CurrentUser() u: AuthUser) {
    return this.onboarding.uploadStoreImage(s, 'banner', file, u.id);
  }

  @HttpCode(200)
  @Post('submit') submit(@CurrentSeller() s: SellerContext, @CurrentUser() u: AuthUser) {
    return this.onboarding.submitForReview(s, u.id);
  }
}

@ApiTags('Admin / Sellers')
@ApiBearerAuth()
@Controller({ path: 'admin/sellers', version: '1' })
export class AdminSellersController {
  constructor(private readonly admin: AdminSellersService) {}

  @RequirePermissions('sellers.read') @Get()
  list(@Query() q: AdminListSellersQuery) { return this.admin.list(q); }

  @RequirePermissions('sellers.read') @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.admin.detail(id); }

  @RequirePermissions('sellers.documents.read') @Get('documents/:docId/url')
  docUrl(@Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() u: AuthUser) { return this.admin.documentUrl(docId, u.id); }

  @RequirePermissions('sellers.approve') @Patch('documents/:docId')
  reviewDoc(@Param('docId', ParseUUIDPipe) docId: string, @Body() dto: ReviewDocumentDto, @CurrentUser() u: AuthUser) {
    return this.admin.reviewDocument(docId, dto, u.id);
  }

  @RequirePermissions('sellers.approve') @HttpCode(200) @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.admin.approve(id, u.id); }

  @RequirePermissions('sellers.approve') @HttpCode(200) @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser) { return this.admin.reject(id, dto.reason, u.id); }

  @RequirePermissions('sellers.suspend') @HttpCode(200) @Post(':id/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser) { return this.admin.suspend(id, dto.reason, u.id); }

  @RequirePermissions('sellers.suspend') @HttpCode(200) @Post(':id/reinstate')
  reinstate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.admin.reinstate(id, u.id); }
}
