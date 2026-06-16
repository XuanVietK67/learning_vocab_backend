import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

/**
 * Standalone migration runner for production — invoked as the Railway api
 * service's pre-deploy command (`npm run db:migration:run:prod`). It runs
 * once per release, with DB access, before the new version serves traffic.
 *
 * Deliberately leaner than data-source.ts: running migrations needs only the
 * connection and the compiled migration files — never the entity classes — so
 * this file pulls no `@/` path aliases and no dev-only `tsconfig-paths`, which
 * are absent from the production image (`npm install --omit=dev`). Migrations are
 * resolved relative to __dirname, so the glob points at dist/database/migrations
 * when compiled and src/database/migrations under ts-node.
 */
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'learning_vocab',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
});

async function run() {
  await dataSource.initialize();
  // The first migration creates tables with `DEFAULT uuid_generate_v4()`, which
  // lives in the uuid-ossp extension. A fresh database (e.g. Railway) doesn't
  // enable it by default, so bootstrap it here. Idempotent.
  await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  const applied = await dataSource.runMigrations();
  console.log(
    applied.length
      ? `Applied ${applied.length} migration(s): ${applied
          .map((m) => m.name)
          .join(', ')}`
      : 'No pending migrations.',
  );
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Migration run failed:', err);
  process.exit(1);
});
