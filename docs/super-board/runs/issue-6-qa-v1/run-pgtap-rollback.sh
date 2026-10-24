#!/bin/bash
# usage: runtests.sh <worktree> <with_migration:0|1> <test files...>
WT=$1; MIG=$2; shift 2
{
  echo "begin;"
  echo "create extension if not exists pgtap with schema extensions;"
  if [ "$MIG" = 1 ]; then cat "$WT/supabase/migrations/20261023170000_row_level_security.sql"; fi
  for f in "$@"; do
    echo "\\echo ### $f"
    sed -e 's/^begin;$/savepoint t;/' -e 's/^rollback;$/reset role; rollback to savepoint t;/' "$WT/supabase/tests/$f"
  done
  echo "rollback;"
} | docker exec -i supabase_db_ssfGala psql -U postgres -X -q -At -v ON_ERROR_STOP=0 2>&1
