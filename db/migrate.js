#!/usr/bin/env node
// Simple numbered-SQL-file migration runner for Neon Postgres.
// Usage: node db/migrate.js
// Reads POSTGRES_URL from .env.local (dotenv) or environment.

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present (for local runs)
try {
  const envPath = join(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch (_) { /* no .env.local, rely on environment */ }

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: POSTGRES_URL or DATABASE_URL not set.');
  process.exit(1);
}

const sql = neon(dbUrl);

async function getCurrentVersion() {
  try {
    const rows = await sql`SELECT MAX(version) AS v FROM schema_version`;
    return rows[0]?.v || 0;
  } catch (_) {
    return 0;
  }
}

async function run() {
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  const current = await getCurrentVersion();
  console.log(`Current schema version: ${current}`);

  let applied = 0;
  for (const file of files) {
    const version = parseInt(file.slice(0, 3), 10);
    if (version <= current) continue;

    const content = readFileSync(join(migrationsDir, file), 'utf-8');
    console.log(`Applying ${file} (v${version})...`);

    const statements = content
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    await sql`INSERT INTO schema_version (version, description) VALUES (${version}, ${file})`;
    applied++;
    console.log(`  ✓ ${file}`);
  }

  if (applied === 0) {
    console.log('Already up to date.');
  } else {
    console.log(`Applied ${applied} migration(s). Current version: ${current + applied}`);
  }
}

run().catch(e => { console.error('Migration failed:', e); process.exit(1); });
