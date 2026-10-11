import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Public store page header. Products come from GET /search?store=<slug> (same filters/sorting as search). */
@ApiTags('Stores')
@Controller({ path: 'stores', version: '1' })
export class StoresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  @Public() @Get(':slug')
  async bySlug(@Param('slug') slug: string) {
    const store = await this.cache.wrap(`store:${slug}`, 60, async () => {
      const s = await this.prisma.store.findFirst({
        where: { slug, isActive: true, seller: { status: 'APPROVED' } },
        select: {
          slug: true, name: true, nameAr: true, description: true, descriptionAr: true, logoKey: true, bannerKey: true, city: true,
          ratingAvg: true, ratingCount: true, createdAt: true,
          _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } },
        },
      });
      if (!s) return null;
      const { logoKey, bannerKey, _count, ...rest } = s;
      return { ...rest, logoUrl: this.storage.publicUrl(logoKey), bannerUrl: this.storage.publicUrl(bannerKey), productCount: _count.products, verified: true };
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }
}

@Module({ controllers: [StoresController] })
export class StoresModule {}
