import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Changes Qatar's cash-on-delivery rules for one test file and returns the function that puts them back.
 * Tests about other features switch the guest phone check off so they do not need SMS codes for every order.
 */
export async function setCodRules(prisma: PrismaService, patch: Record<string, unknown>): Promise<() => Promise<void>> {
  const c = await prisma.country.findUniqueOrThrow({ where: { code: 'QA' }, select: { codRules: true } });
  await prisma.country.update({ where: { code: 'QA' }, data: { codRules: { ...((c.codRules ?? {}) as Record<string, unknown>), ...patch } as Prisma.InputJsonValue } });
  return async () => { await prisma.country.update({ where: { code: 'QA' }, data: { codRules: (c.codRules ?? {}) as Prisma.InputJsonValue } }); };
}
