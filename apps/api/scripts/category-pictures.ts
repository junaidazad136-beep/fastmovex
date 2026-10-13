// Gives every category without a tile picture its drawn default (prisma/category-art.ts), so the categories page never
// shows an empty tile. Pictures the team uploaded in the admin panel are never touched. Safe to run on every deploy
// (scripts/render-build.sh does); without storage settings it does nothing.
//   npx tsx scripts/category-pictures.ts            fill the missing ones
//   npx tsx scripts/category-pictures.ts --redraw   also replace earlier drawn defaults (never uploaded photos)
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { CATEGORY_ART } from '../prisma/category-art';
import { poolTls } from '../src/prisma/pool-tls';

/** drawn defaults are stored under this prefix, uploads under categories/<slug>-… */
export const DRAWN_PREFIX = 'categories/drawn/';

async function main() {
  const e = process.env;
  if (!(e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY && e.S3_BUCKET_PUBLIC)) {
    console.log('category pictures: no storage settings — skipped');
    return;
  }
  const redraw = process.argv.includes('--redraw');
  const s3 = new S3Client({
    region: e.S3_REGION || 'auto', endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(poolTls(e.DATABASE_URL ?? '', e.DATABASE_CA_CERT)) });
  try {
    const cats = await prisma.category.findMany({
      where: { slug: { in: Object.keys(CATEGORY_ART) }, ...(redraw ? { OR: [{ imageKey: null }, { imageKey: { startsWith: DRAWN_PREFIX } }] } : { imageKey: null }) },
      select: { id: true, slug: true },
    });
    let done = 0;
    for (const c of cats) {
      const body = await sharp(Buffer.from(CATEGORY_ART[c.slug]())).webp({ quality: 88, alphaQuality: 92 }).toBuffer();
      const key = `${DRAWN_PREFIX}${c.slug}-${randomUUID().slice(0, 8)}.webp`;
      await s3.send(new PutObjectCommand({ Bucket: e.S3_BUCKET_PUBLIC, Key: key, Body: body, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }));
      // only if still empty (or still a drawn default): an upload made meanwhile wins
      await prisma.category.updateMany({ where: { id: c.id, OR: [{ imageKey: null }, { imageKey: { startsWith: DRAWN_PREFIX } }] }, data: { imageKey: key } });
      done++;
    }
    console.log(`category pictures: ${done} drawn${cats.length ? '' : ' (all categories already have one)'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // a picture problem must never stop a deploy
  console.warn(`category pictures: skipped (${(err as Error).message})`);
});
