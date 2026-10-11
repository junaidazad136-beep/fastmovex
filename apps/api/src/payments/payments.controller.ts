import { UnpaidOrdersService } from '../orders/unpaid-orders.service';
import { Controller, Headers, HttpCode, Module, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { PaymentsService } from './payments.service';
import { CodProvider } from './providers/cod.provider';
import { DibsyProvider } from './providers/dibsy.provider';
import { TestPaymentProvider } from './providers/test.provider';

@ApiTags('Payments')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Gateway callback. Signature is verified against the RAW body, so no auth is needed (and none is trusted). */
  @Public() @SkipThrottle() @ApiExcludeEndpoint() @HttpCode(200)
  @Post('webhook/:provider')
  async webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.payments.handleWebhook(provider, headers, raw);
  }
}

@Module({ controllers: [PaymentsController], providers: [PaymentsService, CodProvider, TestPaymentProvider, DibsyProvider, UnpaidOrdersService], exports: [PaymentsService, UnpaidOrdersService] })
export class PaymentsModule {}
