#!/usr/bin/env bash
# Crea la base de prueba para el e2e: stub de Supabase + migraciones + datos DEMO.
set -euo pipefail
cd "$(dirname "$0")/../../supabase"
DB=${DB:-bbx_e2e}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f tests/00_stub_supabase.sql
for f in migrations/*.sql seed.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
echo "Base $DB lista"
