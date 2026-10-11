import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { OrderLedgerService } from './order-ledger.service';

@Global()
@Module({ providers: [LedgerService, OrderLedgerService], exports: [LedgerService, OrderLedgerService] })
export class LedgerModule {}
