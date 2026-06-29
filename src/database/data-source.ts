import 'dotenv/config';
import 'tsconfig-paths/register';
import { DataSource, DataSourceOptions } from 'typeorm';

const entities = ['src/**/*.entity.ts'];
const migrations = ['src/database/migrations/*.ts'];

// Railway's public proxy may require TLS, and its managed cert isn't in the
// local trust store, so disable verification when DB_SSL=true. Default off keeps
// existing local/prod behaviour unchanged.
const ssl =
  process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

// Prefer a single connection URL (e.g. Railway's DATABASE_PUBLIC_URL) when set;
// otherwise fall back to the discrete DB_* fields. Lets one-off scripts and
// migrations target a remote DB by pasting its URL instead of splitting it into
// five vars.
const options: DataSourceOptions = process.env.DATABASE_URL
  ? {
      type: 'postgres',
      url: process.env.DATABASE_URL,
      ssl,
      entities,
      migrations,
      synchronize: false,
    }
  : {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'learning_vocab',
      ssl,
      entities,
      migrations,
      synchronize: false,
    };

export default new DataSource(options);
