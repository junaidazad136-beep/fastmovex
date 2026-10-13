import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseSizeTable } from './size-chart';
import { CreateSizeChartDto, UpdateSizeChartDto } from './size-charts.dto';

/** At most this many charts per store (FastMoveX's own list has no limit worth enforcing). */
const STORE_LIMIT = 50;

const LIST_SELECT = {
  id: true, storeId: true, name: true, nameAr: true, kind: true, columns: true, rows: true, note: true, noteAr: true, updatedAt: true,
  _count: { select: { products: true, categories: true } },
} as const;

type Owner = { storeId: string | null };

/**
 * Size guides. FastMoveX's charts (no store) are kept by staff and can be category defaults; a store keeps its own
 * charts for its products. Deleting a chart simply leaves its products and categories without one.
 */
@Injectable()
export class SizeChartsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private shape(r: Prisma.SizeChartGetPayload<{ select: typeof LIST_SELECT }>, storeId: string | null = null) {
    const { _count, ...c } = r;
    return { ...c, own: storeId === null ? c.storeId === null : c.storeId === storeId, productCount: _count.products, categoryCount: _count.categories };
  }

  /** Staff: FastMoveX's charts. */
  async listShared() {
    const rows = await this.prisma.sizeChart.findMany({ where: { storeId: null }, orderBy: { name: 'asc' }, select: LIST_SELECT });
    return rows.map((r) => this.shape(r));
  }

  /** A seller: FastMoveX's charts (to use) and the store's own (to use and edit). */
  async listForStore(storeId: string) {
    const rows = await this.prisma.sizeChart.findMany({ where: { OR: [{ storeId: null }, { storeId }] }, orderBy: [{ storeId: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }], select: LIST_SELECT });
    return rows.map((r) => this.shape(r, storeId));
  }

  async get(id: string, owner?: Owner) {
    const r = await this.prisma.sizeChart.findUnique({ where: { id }, select: LIST_SELECT });
    if (!r || (owner && r.storeId !== null && r.storeId !== owner.storeId)) throw new NotFoundException('Size chart not found');
    return this.shape(r, owner?.storeId ?? null);
  }

  async create(owner: Owner, dto: CreateSizeChartDto, actorId: string) {
    const table = parseSizeTable(dto.columns, dto.rows);
    if (owner.storeId) {
      const n = await this.prisma.sizeChart.count({ where: { storeId: owner.storeId } });
      if (n >= STORE_LIMIT) throw new BadRequestException(`A store can keep at most ${STORE_LIMIT} size charts`);
    }
    const c = await this.prisma.sizeChart.create({
      data: {
        storeId: owner.storeId, name: dto.name, nameAr: dto.nameAr, kind: dto.kind ?? 'CLOTHING',
        columns: table.columns as unknown as Prisma.InputJsonValue, rows: table.rows, note: dto.note || null, noteAr: dto.noteAr || null,
      },
      select: { id: true },
    });
    await this.audit.log({ actorId, action: 'sizeChart.create', entityType: 'SizeChart', entityId: c.id, after: { name: dto.name, storeId: owner.storeId } });
    return this.get(c.id, owner);
  }

  async update(owner: Owner, id: string, dto: UpdateSizeChartDto, actorId: string) {
    const current = await this.editable(owner, id);
    const table = dto.columns !== undefined || dto.rows !== undefined
      ? parseSizeTable(dto.columns ?? current.columns, dto.rows ?? current.rows)
      : null;
    await this.prisma.sizeChart.update({
      where: { id },
      data: {
        name: dto.name, nameAr: dto.nameAr, kind: dto.kind,
        ...(table && { columns: table.columns as unknown as Prisma.InputJsonValue, rows: table.rows }),
        note: dto.note === undefined ? undefined : dto.note || null,
        noteAr: dto.noteAr === undefined ? undefined : dto.noteAr || null,
      },
    });
    await this.audit.log({ actorId, action: 'sizeChart.update', entityType: 'SizeChart', entityId: id, after: { fields: Object.keys(dto) } });
    return this.get(id, owner);
  }

  async remove(owner: Owner, id: string, actorId: string) {
    const c = await this.editable(owner, id);
    await this.prisma.sizeChart.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'sizeChart.delete', entityType: 'SizeChart', entityId: id, before: { name: c.name, storeId: c.storeId } });
  }

  /**
   * Checks a chart a product may use: FastMoveX's own, or the product's store's. Categories may only use FastMoveX's.
   * Throws a readable 400.
   */
  async assertUsable(id: string, storeId: string | null): Promise<void> {
    const c = await this.prisma.sizeChart.findUnique({ where: { id }, select: { storeId: true } });
    if (!c || (c.storeId !== null && c.storeId !== storeId)) {
      throw new BadRequestException(storeId ? 'Choose one of FastMoveX\'s size charts or one of your own' : 'Only FastMoveX size charts can be a category default');
    }
  }

  private async editable(owner: Owner, id: string) {
    const c = await this.prisma.sizeChart.findUnique({ where: { id } });
    // a store edits only its own charts; staff edit FastMoveX's
    if (!c || c.storeId !== owner.storeId) throw new NotFoundException('Size chart not found');
    return c;
  }
}
