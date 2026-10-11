import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { SellerContext } from '../common/auth-user';
import { CryptoService } from '../common/crypto/crypto.service';
import { isValidIban, normalizeIban } from '../common/utils/iban';
import { slugify, uniqueSlug } from '../common/utils/slug';
import { PrismaService } from '../prisma/prisma.service';
import { validateUpload } from '../storage/file-validation';
import { StorageService } from '../storage/storage.service';
import { ApplySellerDto, UpdateBankDto, UpdateSellerProfileDto } from './dto/seller.dto';

const LEGAL_FIELDS = ['businessName', 'legalName', 'commercialRegNo', 'taxNumber'] as const;
const REQUIRED_DOCS: DocumentType[] = ['COMMERCIAL_REGISTRATION'];
const MAX_DOCUMENTS = 20;

@Injectable()
export class SellerOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
  ) {}

  /** Any logged-in user can apply. They get the SELLER role now; seller routes stay locked until approval. */
  async apply(userId: string, dto: ApplySellerDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { countryCode: true, seller: { select: { id: true } } } });
    if (!user) throw new NotFoundException('User not found');
    if (user.seller) throw new ConflictException('You already have a seller account');

    const sellerRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'SELLER' } });
    const base = slugify(dto.storeName, 50);
    const taken = await this.prisma.store.findUnique({ where: { slug: base }, select: { id: true } });

    try {
      const seller = await this.prisma.$transaction(async (tx) => {
        const s = await tx.seller.create({
          data: {
            ownerUserId: userId,
            businessName: dto.businessName,
            commercialRegNo: dto.commercialRegNo,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            countryCode: user.countryCode,
            store: {
              create: {
                slug: taken ? uniqueSlug(dto.storeName) : base,
                name: dto.storeName,
                nameAr: dto.storeNameAr,
                description: dto.description,
                isActive: false, // becomes active on approval
              },
            },
          },
          select: { id: true, status: true, store: { select: { slug: true, name: true } } },
        });
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: sellerRole.id } },
          update: {},
          create: { userId, roleId: sellerRole.id },
        });
        return s;
      });
      await this.audit.log({ actorId: userId, action: 'seller.apply', entityType: 'Seller', entityId: seller.id });
      // Client must call POST /auth/refresh to receive a token that includes the SELLER role.
      return { ...seller, requiresTokenRefresh: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already have a seller account');
      }
      throw err;
    }
  }

  async getMine(sellerId: string) {
    const s = await this.prisma.seller.findUniqueOrThrow({
      where: { id: sellerId },
      select: {
        id: true, businessName: true, legalName: true, commercialRegNo: true, taxNumber: true,
        contactEmail: true, contactPhone: true, countryCode: true, status: true, rejectionReason: true,
        approvedAt: true, bankName: true, accountHolder: true, ibanLast4: true, createdAt: true,
        store: { select: { id: true, slug: true, name: true, nameAr: true, description: true, descriptionAr: true, logoKey: true, bannerKey: true, city: true, isActive: true } },
        documents: { select: { id: true, type: true, status: true, note: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    const { store, ...rest } = s;
    return {
      ...rest,
      store: store && { ...store, logoUrl: this.storage.publicUrl(store.logoKey), bannerUrl: this.storage.publicUrl(store.bannerKey) },
      checklist: this.checklist({ hasBank: !!s.ibanLast4, commercialRegNo: s.commercialRegNo, documents: s.documents }),
    };
  }

  async updateProfile(seller: SellerContext, dto: UpdateSellerProfileDto, actorId: string) {
    if (seller.status === 'APPROVED' && LEGAL_FIELDS.some((f) => dto[f] !== undefined)) {
      throw new BadRequestException('Legal details of an approved seller can only be changed through support');
    }
    await this.prisma.seller.update({
      where: { id: seller.id },
      data: {
        businessName: dto.businessName, legalName: dto.legalName, commercialRegNo: dto.commercialRegNo, taxNumber: dto.taxNumber,
        contactEmail: dto.contactEmail, contactPhone: dto.contactPhone,
        store: {
          update: { name: dto.storeName, nameAr: dto.storeNameAr, description: dto.description, descriptionAr: dto.descriptionAr, city: dto.city },
        },
      },
    });
    await this.audit.log({ actorId, action: 'seller.profile_update', entityType: 'Seller', entityId: seller.id, after: Object.keys(dto) });
    return this.getMine(seller.id);
  }

  async updateBank(seller: SellerContext, dto: UpdateBankDto, actorId: string) {
    const iban = normalizeIban(dto.iban);
    if (!isValidIban(iban)) throw new BadRequestException('IBAN is not valid. Check it on your bank statement.');
    await this.prisma.seller.update({
      where: { id: seller.id },
      data: { bankName: dto.bankName, accountHolder: dto.accountHolder, ibanEncrypted: this.crypto.encrypt(iban), ibanLast4: iban.slice(-4) },
    });
    // Bank change is a classic fraud vector: always audited (never with the IBAN itself)
    await this.audit.log({ actorId, action: 'seller.bank_update', entityType: 'Seller', entityId: seller.id, after: { ibanLast4: iban.slice(-4), bankName: dto.bankName } });
    return { bankName: dto.bankName, accountHolder: dto.accountHolder, ibanLast4: iban.slice(-4) };
  }

  async uploadDocument(seller: SellerContext, type: DocumentType, file: Express.Multer.File | undefined, actorId: string) {
    const f = validateUpload(file, 'document');
    const count = await this.prisma.sellerDocument.count({ where: { sellerId: seller.id } });
    if (count >= MAX_DOCUMENTS) throw new BadRequestException('Too many documents. Contact support.');

    const key = `sellers/${seller.id}/documents/${randomUUID()}.${f.ext}`;
    await this.storage.put('private', key, f.buffer, f.mime);
    const doc = await this.prisma.sellerDocument.create({
      data: { sellerId: seller.id, type, fileKey: key, mimeType: f.mime },
      select: { id: true, type: true, status: true, createdAt: true },
    });
    await this.audit.log({ actorId, action: 'seller.document_upload', entityType: 'SellerDocument', entityId: doc.id, after: { type } });
    return doc;
  }

  async uploadStoreImage(seller: SellerContext, kind: 'logo' | 'banner', file: Express.Multer.File | undefined, actorId?: string) {
    const f = validateUpload(file, 'image');
    const store = await this.prisma.store.findUniqueOrThrow({ where: { sellerId: seller.id }, select: { id: true, logoKey: true, bannerKey: true } });
    const key = `stores/${store.id}/${kind}-${randomUUID()}.${f.ext}`;
    await this.storage.put('public', key, f.buffer, f.mime);
    const old = kind === 'logo' ? store.logoKey : store.bannerKey;
    await this.prisma.store.update({ where: { id: store.id }, data: kind === 'logo' ? { logoKey: key } : { bannerKey: key } });
    if (old) await this.storage.delete('public', old).catch(() => undefined);
    await this.audit.log({ actorId: actorId ?? null, action: `store.${kind}_update`, entityType: 'Store', entityId: store.id, before: { key: old }, after: { key } });
    return { url: this.storage.publicUrl(key) };
  }

  async submitForReview(seller: SellerContext, actorId: string) {
    if (!['PENDING', 'REJECTED'].includes(seller.status)) {
      throw new BadRequestException(seller.status === 'UNDER_REVIEW' ? 'Application is already under review' : 'Nothing to submit');
    }
    const s = await this.prisma.seller.findUniqueOrThrow({
      where: { id: seller.id },
      select: { ibanEncrypted: true, commercialRegNo: true, documents: { select: { type: true, status: true } } },
    });
    const missing = this.checklist({ hasBank: !!s.ibanEncrypted, commercialRegNo: s.commercialRegNo, documents: s.documents }).filter((c) => !c.done).map((c) => c.label);
    if (missing.length) throw new BadRequestException({ message: 'Application is incomplete', missing });

    await this.prisma.seller.update({ where: { id: seller.id }, data: { status: 'UNDER_REVIEW', rejectionReason: null } });
    await this.audit.log({ actorId, action: 'seller.submit', entityType: 'Seller', entityId: seller.id });
    return { status: 'UNDER_REVIEW' as const };
  }

  /** What the seller still needs to do before submitting. Shown as a checklist in the dashboard. */
  checklist(s: { hasBank: boolean; commercialRegNo: string | null; documents: { type: DocumentType; status: string }[] }) {
    return [
      { key: 'cr_number', label: 'Commercial Registration number', done: !!s.commercialRegNo },
      ...REQUIRED_DOCS.map((type) => ({
        key: `doc_${type.toLowerCase()}`,
        label: `Upload ${type.replace(/_/g, ' ').toLowerCase()}`,
        done: s.documents.some((d) => d.type === type && d.status !== 'REJECTED'),
      })),
      { key: 'bank', label: 'Bank account (IBAN) for payouts', done: s.hasBank },
    ];
  }
}
