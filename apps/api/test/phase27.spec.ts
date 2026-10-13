import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CATEGORY_ART } from '../prisma/category-art';
import { buildTree } from '../src/categories/categories.service';
import { roundBought } from '../src/products/public-products.service';
import { tilePicture } from '../src/storage/photo';

describe('Phase 27 — category tile pictures', () => {
  it('the public tree carries each category tile picture', () => {
    const tree = buildTree(
      [{ id: 'a', parentId: null, slug: 'beauty', name: 'Beauty', nameAr: 'الجمال', iconKey: null, imageKey: 'categories/beauty.webp', sortOrder: 0 }],
      (k) => (k ? `https://cdn/${k}` : null),
    );
    expect(tree[0].imageUrl).toBe('https://cdn/categories/beauty.webp');
    expect(tree[0].iconUrl).toBeNull();
  });

  it('every base category has a drawn default picture', () => {
    const seed = readFileSync(join(__dirname, '../prisma/seed.ts'), 'utf8');
    const block = seed.slice(seed.indexOf('const CATEGORIES'), seed.indexOf('];', seed.indexOf('const CATEGORIES')));
    const slugs = [...block.matchAll(/\['([a-z-]+)',/g)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThan(20);
    for (const s of slugs) expect(Object.keys(CATEGORY_ART)).toContain(s);
  });

  it.each(Object.keys(CATEGORY_ART))('%s draws as a 600 px picture with a transparent background', async (slug) => {
    const img = sharp(Buffer.from(CATEGORY_ART[slug]()));
    const meta = await img.metadata();
    expect([meta.width, meta.height]).toEqual([600, 600]);
    const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // top-left corner is see-through: the tile draws its own background
  });

  it('an uploaded picture keeps its transparency and is shrunk to 800 px', async () => {
    const png = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await tilePicture(png);
    expect(out.mime).toBe('image/webp');
    expect([out.width, out.height]).toEqual([800, 600]);
    expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true);
  });

  it('a file that is not a picture is refused', async () => {
    await expect(tilePicture(Buffer.from('not an image'))).rejects.toThrow('could not be read');
  });
});


describe('Phase 27 — "bought in past month"', () => {
  it.each([[0, 0], [9, 0], [10, 10], [19, 10], [37, 20], [64, 50], [99, 50], [100, 100], [340, 300], [999, 900], [2750, 2000]])('%i units → shows %i+', (n, shown) => {
    expect(roundBought(n)).toBe(shown);
  });
});
