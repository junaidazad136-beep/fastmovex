/**
 * PHASE 27 on a real database: the admin uploads a category's tile picture; the categories list and the home page's
 * category row show it; removing it clears it. Only catalogue managers may change it.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Pass-2026';

describe('Phase 27 — category tile pictures (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let before: string | null = null;
  let id = '';
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (identifier: string) => (await api().post('/api/v1/auth/login').send({ identifier, password: DEMO_PASSWORD }).expect(200)).body.accessToken as string;
  const tree = async () => (await api().get('/api/v1/categories').expect(200)).body as { slug: string; imageUrl: string | null }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'gifts' } });
    id = cat.id;
    before = cat.imageKey;
  });

  afterAll(async () => {
    await prisma.category.update({ where: { id }, data: { imageKey: before } });
    await app.close();
  });

  it('the admin uploads a picture: kept as WebP with transparency, shown in the categories list', async () => {
    const admin = await login('admin@demo.jovia.test');
    const png = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 116, g: 34, b: 230, alpha: 0.5 } } }).png().toBuffer();
    const res = await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).attach('file', png, 'gifts.png').expect(200);
    expect(res.body.imageUrl).toMatch(/categories\/gifts-[0-9a-f]{8}\.webp$/);
    const row = await prisma.category.findUniqueOrThrow({ where: { id } });
    expect(row.imageKey).toMatch(/^categories\/gifts-/);
    // the public list is cached for a minute: a change clears it
    expect((await tree()).find((c) => c.slug === 'gifts')!.imageUrl).toBe(res.body.imageUrl);
    const list = (await api().get('/api/v1/admin/categories').set(bearer(admin)).expect(200)).body as { id: string; imageUrl: string | null }[];
    expect(list.find((c) => c.id === id)!.imageUrl).toBe(res.body.imageUrl);

    await api().delete(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).expect(204);
    expect((await prisma.category.findUniqueOrThrow({ where: { id } })).imageKey).toBeNull();
    expect((await tree()).find((c) => c.slug === 'gifts')!.imageUrl).toBeNull();
  });

  it('a file that is not a picture is refused, and a customer cannot change it', async () => {
    const admin = await login('admin@demo.jovia.test');
    await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(admin)).attach('file', Buffer.from('%PDF-1.4 nope'), 'x.pdf').expect(400);
    const customer = await login('customer@demo.jovia.test');
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#fff' } }).png().toBuffer();
    await api().post(`/api/v1/admin/categories/${id}/image`).set(bearer(customer)).attach('file', png, 'x.png').expect(403);
  });
});
