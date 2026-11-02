#!/usr/bin/env bash
# Pruebas locales del esquema: crea una base limpia, aplica el stub de Supabase,
# las migraciones, el seed DEMO y corre los tests de RLS y de negocio.
# Uso: PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-bbx_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run tests/00_stub_supabase.sql
for f in migrations/*.sql; do echo "→ $f"; run "$f"; done
echo "→ seed.sql"; run seed.sql
for f in tests/[1-9]*.sql; do echo "→ $f"; run "$f"; done
echo "OK: todas las pruebas pasaron"
