import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * CLI config (migrate / seed / studio). The API itself runs engine-free (WebAssembly query compiler +
 * node-postgres, see src/prisma/prisma.service.ts), so production containers need no native query engine.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
});
