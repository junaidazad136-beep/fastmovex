import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENTS } from '../notifications/notification.events';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LedgerAccountType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { afterCursor, decodeCursor, toPage } from '../common/utils/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AdminListSellersQuery, ReviewDocumentDto } from './dto/seller.dto';

const SELLER_ACCOUNTS: LedgerAccountType[] = ['SELLER_PENDING', 'SELLER_AVAILABLE', 'SELLER_PAID'];
const PAGE = 25;

@Injectable()
export class AdminSellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async list(q: AdminListSellersQuery) {
    const where: Prisma.SellerWhereInput = {
      status: q.status,
      ...(q.q && {
        OR: [
          { businessName: { contains: q.q, mode: 'insensitive' } },
          { contactEmail: { contains: q.q, mode: 'insensitive' } },
          { commercialRegNo: { contains: q.q } },
          { store: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      }),
      ...afterCursor(decodeCursor(q.cursor)),
    };
    const rows = await this.prisma.seller.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: {
        id: true, businessName: true, contactEmail: true, contactPhone: true, countryCode: true, status: true, createdAt: true, isHouse: true,
        store: { select: { name: true, slug: true } },
        _count: { select: { documents: true } },
      },
    });
    return toPage(rows, PAGE);
  }

  async detail(id: string) {
    const s = await this.prisma.seller.findUnique({
      where: { id },
      select: {
        id: true, businessName: true, legalName: true, commercialRegNo: true, taxNumber: true, contactEmail: true, contactPhone: true,
        countryCode: true, status: true, rejectionReason: true, approvedAt: true, approvedById: true,
        bankName: true, accountHolder: true, ibanLast4: true, createdAt: true,
        owner: { select: { id: true, fullName: true, email: true, phone: true, createdAt: true } },
        store: { select: { id: true, slug: true, name: true, isActive: true } },
        documents: { select: { id: true, type: true, mimeType: true, status: true, note: true, reviewedAt: true, createdAt: true } },
        _count: { select: { sellerOrders: true } },
      },
    });
    if (!s) throw new NotFoundException('Seller not found');
    return s;
  }

  /** Signed 5-minute link. Every view of a private document is audited. */
  async documentUrl(docId: string, adminId: string) {
    const doc = await this.prisma.sellerDocument.findUnique({ where: { id: docId }, select: { id: true, fileKey: true, sellerId: true } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.audit.log({ actorId: adminId, action: 'seller.document_view', entityType: 'SellerDocument', entityId: doc.id });
    return { url: await this.storage.signedUrl(doc.fileKey, 300), expiresIn: 300 };
  }

  async reviewDocument(docId: string, dto: ReviewDocumentDto, adminId: string) {
    const doc = await this.prisma.sellerDocument.update({
      where: { id: docId },
      data: { status: dto.status, note: dto.note, reviewedById: adminId, reviewedAt: new Date() },
      select: { id: true, status: true },
    }).catch(() => { throw new NotFoundException('Document not found'); });
    await this.audit.log({ actorId: adminId, action: 'seller.document_review', entityType: 'SellerDocument', entityId: docId, after: { status: dto.status } });
    return doc;
  }

  async approve(id: string, adminId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      select: { status: true, country: { select: { currencyCode: true } }, documents: { select: { type: true, status: true } } },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    if (seller.status !== 'UNDER_REVIEW') throw new BadRequestException(`Only applications under review can be approved (current: ${seller.status})`);
    if (!seller.documents.some((d) => d.type === 'COMMERCIAL_REGISTRATION' && d.status === 'APPROVED')) {
      throw new BadRequestException('Approve the Commercial Registration document first');
    }

    const currencyCode = seller.country.currencyCode;
    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: adminId, rejectionReason: null } });
      await tx.store.update({ where: { sellerId: id }, data: { isActive: true } });
      for (const type of SELLER_ACCOUNTS) {
        await tx.ledgerAccount.upsert({
          where: { type_sellerId_currencyCode: { type, sellerId: id, currencyCode } },
          update: {},
          create: { type, sellerId: id, currencyCode },
        });
      }
      await this.audit.log({ actorId: adminId, action: 'seller.approve', entityType: 'Seller', entityId: id, before: { status: seller.status }, after: { status: 'APPROVED' } }, tx);
    });
    this.events?.emit(EVENTS.SELLER_APPROVED, { id });
    return { id, status: 'APPROVED' as const };
  }

  async reject(id: string, reason: string, adminId: string) {
    const r = await this.transition(id, ['UNDER_REVIEW'], 'REJECTED', adminId, { rejectionReason: reason }, reason);
    this.events?.emit(EVENTS.SELLER_REJECTED, { id, reason });
    return r;
  }

  async suspend(id: string, reason: string, adminId: string) {
    return this.transition(id, ['APPROVED'], 'SUSPENDED', adminId, { rejectionReason: reason, store: { update: { isActive: false } } }, reason);
  }

  async reinstate(id: string, adminId: string) {
    return this.transition(id, ['SUSPENDED'], 'APPROVED', adminId, { rejectionReason: null, store: { update: { isActive: true } } });
  }

  private async transition(
    id: string, from: string[], to: 'REJECTED' | 'SUSPENDED' | 'APPROVED', adminId: string, extra: Prisma.SellerUpdateInput, reason?: string,
  ) {
    const s = await this.prisma.seller.findUnique({ where: { id }, select: { status: true } });
    if (!s) throw new NotFoundException('Seller not found');
    if (!from.includes(s.status)) throw new BadRequestException(`Cannot change seller from ${s.status} to ${to}`);
    await this.prisma.seller.update({ where: { id }, data: { status: to, ...extra } });
    await this.audit.log({ actorId: adminId, action: `seller.${to.toLowerCase()}`, entityType: 'Seller', entityId: id, before: { status: s.status }, after: { status: to, reason: reason ?? null } });
    return { id, status: to };
  }
}
