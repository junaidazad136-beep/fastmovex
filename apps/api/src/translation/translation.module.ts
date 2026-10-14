import { Global, Module } from '@nestjs/common';
import { AdminTranslationController, TranslationService } from './translation.service';

@Global()
@Module({
  controllers: [AdminTranslationController],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
