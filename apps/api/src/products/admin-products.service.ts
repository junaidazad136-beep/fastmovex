import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async approve(id: string, adminId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, store: { select: { isActive: true, seller: { select: { status: true } } } } },
    });
    if (!p) throw new NotFoundException('Product not found');
    if (p.status !== 'PENDING_REVIEW') throw new BadRequestException(`Only products pending review can be approved (current: ${p.status})`);
    if (p.store.seller.status !== 'APPROVED') throw new BadRequestException('Seller is not approved');
    await this.prisma.product.update({ where: { id }, data: { status: 'ACTIVE', moderationNote: null } });
    await this.audit.log({ actorId: adminId, action: 'product.approve', entityType: 'Product', entityId: id });
    return { id, status: 'ACTIVE' as const };
  }

  async reject(id: string, reason: string | undefined, adminId: string) {
    if (!reason) throw new BadRequestException('A reason is required so the seller knows what to fix');
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
    if (!p) throw new NotFoundException('Product not found');
    if (!['PENDING_REVIEW', 'ACTIVE'].includes(p.status)) throw new BadRequestException(`Cannot reject a ${p.status} product`);
    await this.prisma.product.update({ where: { id }, data: { status: 'REJECTED', moderationNote: reason } });
    await this.audit.log({ actorId: adminId, action: 'product.reject', entityType: 'Product', entityId: id, before: { status: p.status }, after: { reason } });
    return { id, status: 'REJECTED' as const };
  }

  async setFeatured(id: string, featured: boolean, adminId: string) {
    await this.prisma.product.update({ where: { id }, data: { isFeatured: featured } }).catch(() => { throw new NotFoundException('Product not found'); });
    await this.audit.log({ actorId: adminId, action: featured ? 'product.feature' : 'product.unfeature', entityType: 'Product', entityId: id });
    return { id, isFeatured: featured };
  }
}
