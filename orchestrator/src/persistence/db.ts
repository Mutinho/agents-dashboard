import pg from 'pg';

const { Pool } = pg;

export function createPool(): pg.Pool {
  return new Pool({
    host: process.env.POSTGRES_HOST ?? 'db',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'own_ia',
    password: process.env.POSTGRES_PASSWORD ?? '',
    database: process.env.POSTGRES_DB ?? 'own_ia',
    max: 10,
  });
}

export type Pool = pg.Pool;
