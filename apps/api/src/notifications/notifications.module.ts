import { Body, Controller, Delete, Get, Global, Headers, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { OrderAccessService } from '../common/order-access.service';
import { EmailSender, PushSender, SmsSender, WhatsAppSender } from './channels/senders';
import { NotificationListener } from './notification.listener';
import { NotificationsService } from './notifications.service';
import { WebPushService } from './web-push';

class DeviceDto {
  @ApiProperty() @IsString() @Length(20, 4096) token: string;
  @ApiProperty({ enum: ['ios', 'android', 'web'] }) @IsIn(['ios', 'android', 'web']) platform: string;
}
class SettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  @ApiPropertyOptional({ description: 'Order updates on WhatsApp (needs a mobile number on the account)' }) @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
}
class PushKeysDto {
  @ApiProperty() @IsString() @Length(20, 200) p256dh: string;
  @ApiProperty() @IsString() @Length(8, 100) auth: string;
}
class PushSubscriptionDto {
  @ApiProperty({ description: 'The browser push service URL (https only)' }) @IsString() @Length(20, 1000) @Matches(/^https:\/\//) endpoint: string;
  @ApiProperty({ type: PushKeysDto }) @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
}
class PushEndpointDto { @ApiProperty() @IsString() @Length(20, 1000) endpoint: string; }
class InboxQuery { @ApiPropertyOptional() @IsOptional() @IsISO8601() cursor?: string; }

@ApiTags('Account / Notifications')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class NotificationsController {
  constructor(private readonly svc: NotificationsService, private readonly webPush: WebPushService) {}

  @Get('notifications') inbox(@CurrentUser() u: AuthUser, @Query() q: InboxQuery) { return this.svc.inbox(u.id, q.cursor); }
  @Get('notifications/unread-count') unread(@CurrentUser() u: AuthUser) { return this.svc.unreadCount(u.id); }
  @HttpCode(200) @Post('notifications/read-all') readAll(@CurrentUser() u: AuthUser) { return this.svc.markRead(u.id); }
  @HttpCode(200) @Post('notifications/:id/read') read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.markRead(u.id, id); }

  @HttpCode(204) @Post('devices') device(@CurrentUser() u: AuthUser, @Body() d: DeviceDto) { return this.svc.registerDevice(u.id, d.token, d.platform); }
  @HttpCode(204) @Delete('devices/:token') removeDevice(@CurrentUser() u: AuthUser, @Param('token') t: string) { return this.svc.removeDevice(u.id, t); }

  /** Website browser notifications: the public key the browser needs, and whether it is switched on. */
  @Get('push') push(@CurrentUser() u: AuthUser) {
    return this.webPush.count(u.id).then((browsers) => ({ enabled: this.webPush.enabled(), publicKey: this.webPush.publicKey(), browsers }));
  }
  @Post('push/subscriptions') subscribe(@CurrentUser() u: AuthUser, @Body() d: PushSubscriptionDto, @Headers('user-agent') ua?: string) { return this.webPush.subscribe(u.id, d, ua); }
  @HttpCode(200) @Post('push/subscriptions/remove') unsubscribe(@CurrentUser() u: AuthUser, @Body() d: PushEndpointDto) { return this.webPush.unsubscribe(u.id, d.endpoint); }

  @Patch('notification-settings') settings(@CurrentUser() u: AuthUser, @Body() d: SettingsDto) { return this.svc.settings(u.id, d); }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListener, EmailSender, SmsSender, PushSender, WhatsAppSender, WebPushService, OrderAccessService],
  exports: [NotificationsService, OrderAccessService, WebPushService],
})
export class NotificationsModule {}
