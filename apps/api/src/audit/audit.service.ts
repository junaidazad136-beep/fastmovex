import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string; // e.g. "auth.refresh_reuse_detected", "seller.approve"
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit failure must not break the request, but it is logged loudly. */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      await (tx ?? this.prisma).auditLog.create({ data: entry });
    } catch (err) {
      this.logger.error(`AUDIT WRITE FAILED: ${entry.action}`, (err as Error).stack);
    }
  }
}
