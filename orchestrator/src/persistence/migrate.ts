import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool } from './db.js';

// Runner de migraciones muy simple: aplica en orden los .sql de ../../migrations
// que aún no estén registrados en la tabla schema_migrations.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

export async function migrate(): Promise<void> {
  const pool = createPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) {
        console.log(`[migrate] skip ${file} (ya aplicada)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] aplicando ${file}...`);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`[migrate] OK ${file}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }
    console.log('[migrate] completado');
  } finally {
    await pool.end();
  }
}

// Permite ejecutarlo directamente: node dist/persistence/migrate.js
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((e) => {
    console.error('[migrate] ERROR', e);
    process.exit(1);
  });
}
