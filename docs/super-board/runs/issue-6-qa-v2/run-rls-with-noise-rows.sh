#!/bin/bash
# usage: run-rls-with-noise-rows.sh <worktree> <test files...>
# Applies the RLS migration and noise-rows.sql (rows owned by no test), then
# runs each pgTAP file. Everything happens in one transaction that rolls back.
WT=$1; shift
HERE=$(cd "$(dirname "$0")" && pwd)
{
  printf 'begin;\ncreate extension if not exists pgtap with schema extensions;\n'
  cat "$WT/supabase/migrations/20261023170000_row_level_security.sql" "$HERE/noise-rows.sql"
  for f in "$@"; do
    printf '%s\n' "\\echo ### ${f##*/}"
    sed -e 's/^begin;$/savepoint t;/' -e 's/^rollback;$/reset role; rollback to savepoint t;/' "$f"
  done
  printf 'rollback;\n'
} | docker exec -i supabase_db_ssfGala psql -U postgres -X -q -At -v ON_ERROR_STOP=0 2>&1
