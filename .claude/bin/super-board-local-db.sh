#!/usr/bin/env bash
# super-board-local-db.sh — keep parallel lanes and the merge gate off each
# other's local Supabase database.
#
# Every lane and the merge gate share one local stack (`supabase start`). When
# one of them reset it, another lane's tests ran against a database that changed
# under them (#87). Two tools fix that:
#
#   scratch -- <cmd...>
#       Make a throwaway database in the local Postgres, copied from the main
#       database's Supabase schemas and grants (auth, storage, extensions,
#       roles' default privileges) but none of `public`. Run <cmd> with
#       SB_SCRATCH_DB_URL pointing at it, then drop it — on pass, fail, Ctrl-C
#       or TERM. Use it for anything that talks to Postgres directly:
#         supabase db reset --db-url "$SB_SCRATCH_DB_URL" --yes
#         supabase test db  --db-url "$SB_SCRATCH_DB_URL"
#       Scratch databases left by a SIGKILL are dropped by the next scratch run
#       once older than --stale-after.
#
#   lock -- <cmd...>
#       Run <cmd> holding the local-stack lock: for steps that need the local
#       API on the main database (reset or seed it, e2e, app tests through
#       supabase-js). A second caller waits, then runs once the lock is free.
#       A lock whose holder died is reaped at once; one older than --stale-after
#       is reaped too, and so is one with no pid file after a 10 s grace.
#
#   reset-main
#       `lock` around a reset of the main database that does NOT restart the
#       containers. A plain `supabase db reset` recreates the db container,
#       which wipes every scratch database another lane is using.
#
# Options (before `--`): --timeout <s> (lock wait, default 1800)
#                        --stale-after <s> (default 5400)
#
# The URLs use host `localhost` and sslmode=disable on purpose: with the stack's
# own host (127.0.0.1) the Supabase CLI treats `--db-url` as the local stack
# and does a full container reset of the main database instead.
#
# Exit codes: <cmd>'s own · 4 lock not taken in time · 5 local stack not running
#             · 64 usage
set -euo pipefail

TIMEOUT=1800
STALE_AFTER=5400
MODE="${1:-}"; [ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout)     TIMEOUT="$2"; shift 2 ;;
    --stale-after) STALE_AFTER="$2"; shift 2 ;;
    --)            shift; break ;;
    *)             echo "unknown option: $1" >&2; exit 64 ;;
  esac
done
case "$MODE" in
  scratch|lock) [ $# -gt 0 ] || { echo "usage: $0 $MODE [opts] -- <cmd...>" >&2; exit 64; } ;;
  reset-main)   ;;
  *) echo "usage: $0 scratch|lock [--timeout s] [--stale-after s] -- <cmd...> | reset-main" >&2; exit 64 ;;
esac

say() { echo "[local-db] $*" >&2; }

ROOT=$(git rev-parse --show-toplevel)
# The lock lives in the main checkout, so every worktree sees the same one.
MAIN=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
LOCK_DIR="${SB_LOCAL_STACK_LOCK:-$MAIN/.claude/super-board/inflight/local-stack.lock}"

TOML="$ROOT/supabase/config.toml"
PROJECT_ID=$(sed -n 's/^project_id *= *"\(.*\)".*/\1/p' "$TOML" 2>/dev/null | head -1)
DB_PORT=$(awk '/^\[/{s=$0} s=="[db]" && /^port *=/{gsub(/[^0-9]/,"");print;exit}' "$TOML" 2>/dev/null)
CONTAINER="supabase_db_${PROJECT_ID}"
url() { printf 'postgresql://postgres:postgres@localhost:%s/%s?sslmode=disable' "$DB_PORT" "$1"; }
export SB_MAIN_DB_URL; SB_MAIN_DB_URL=$(url postgres)

need_stack() {
  if [ -z "$PROJECT_ID" ] || [ -z "$DB_PORT" ] || \
     ! docker exec "$CONTAINER" pg_isready -q -U postgres >/dev/null 2>&1; then
    say "local Supabase stack is not running (container ${CONTAINER}); run \`supabase start\`"
    exit 5
  fi
}
admin_sql() { docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -qAt -U supabase_admin -d postgres -c "$1"; }

# ---- the local-stack lock ------------------------------------------------------
# mkdir is atomic: exactly one caller gets it. `pid` and `host` let a waiter see
# that the holder is gone and reap at once instead of waiting out stale-after.
#
# Every change to the lock (take, reap, release) happens under a kernel flock on
# the lock's parent directory (#92). A waiter judges the lock and removes it in
# one step under that mutex, so no one can swap in a fresh lock between the two,
# and the kernel drops the mutex when its holder dies, so it never goes stale.
# Since `pid` is written under the mutex too, a lock without one was left by a
# caller that died mid-take; it is reaped once older than GRACE seconds.
# SB_LOCK_REAP_PAUSE (seconds, tests only) pauses between judging and reaping.
GRACE=10
HOST=$(hostname)
LOCK_HELD=0
LOCK_PARENT=$(dirname "$LOCK_DIR")
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

# Fd 9 holds the flock; it is closed again before any command runs.
mutex_on() {
  exec 9<"$LOCK_PARENT" &&
    perl -MFcntl=:flock -e 'open(my $f, "<&=9") or die "fd 9: $!\n"; flock($f, LOCK_EX) or die "flock: $!\n"'
}
mutex_off() { exec 9<&-; }

# Prints why the lock is stale and succeeds, or fails when it is live.
stale() {
  local pid now age
  pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
  now=$(date +%s)
  if [ -z "$pid" ]; then
    age=$(( now - $(mtime "$LOCK_DIR" || echo "$now") ))
    [ "$age" -gt "$GRACE" ] && { echo "no pid, ${age}s old"; return 0; }
    return 1
  fi
  age=$(( now - $(cat "$LOCK_DIR/at" 2>/dev/null || echo "$now") ))
  if [ "$(cat "$LOCK_DIR/host" 2>/dev/null)" = "$HOST" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "pid ${pid} gone"; return 0
  fi
  [ "$age" -gt "$STALE_AFTER" ] && { echo "pid ${pid}, ${age}s old"; return 0; }
  return 1
}

acquire() {
  local waited=0 why
  mkdir -p "$LOCK_PARENT"
  while :; do
    mutex_on || { say "could not lock ${LOCK_PARENT} (needs perl)"; return 1; }
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_HELD=1
      echo "$$" > "$LOCK_DIR/pid"; echo "$HOST" > "$LOCK_DIR/host"; date +%s > "$LOCK_DIR/at"
      mutex_off; return 0
    fi
    if why=$(stale); then
      [ -n "${SB_LOCK_REAP_PAUSE:-}" ] && sleep "$SB_LOCK_REAP_PAUSE" 9<&-
      rm -rf "$LOCK_DIR"; mutex_off
      say "reaped the local-stack lock (${why})"
      continue
    fi
    mutex_off
    [ "$waited" -eq 0 ] && say "waiting for the local-stack lock (held by pid $(cat "$LOCK_DIR/pid" 2>/dev/null || echo ?))"
    [ "$waited" -ge "$TIMEOUT" ] && return 1
    sleep 1; waited=$(( waited + 1 ))
  done
}

release() {
  [ "$LOCK_HELD" -eq 1 ] || return 0
  mutex_on || return 0
  [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK_DIR"
  mutex_off
}

# ---- scratch databases -----------------------------------------------------------
SCRATCH=""
reap_scratch() {
  local now name born
  now=$(date +%s)
  for name in $(admin_sql "select datname from pg_database where datname like 'sb\_scratch\_%'"); do
    born=$(echo "$name" | sed -n 's/^sb_scratch_\([0-9]*\)_.*/\1/p')
    if [ -n "$born" ] && [ $(( now - born )) -gt "$STALE_AFTER" ]; then
      say "dropping abandoned scratch database ${name}"
      admin_sql "drop database if exists \"${name}\" with (force)" || true
    fi
  done
}
make_scratch() {
  SCRATCH="sb_scratch_$(date +%s)_$$"
  local dump="/tmp/${SCRATCH}.dump" try
  admin_sql "create database \"${SCRATCH}\" template template0 owner postgres"
  # Schema of everything the Supabase image owns, plus public's grants and the
  # default privileges that give anon/authenticated/service_role access to new
  # tables. Nothing else from public: migrations build that. Retried because a
  # lane holding the lock may be resetting the main database at this moment.
  for try in 1 2 3; do
    if docker exec "$CONTAINER" sh -c "
         pg_dump -U supabase_admin -d postgres -Fc --schema-only \
           --exclude-schema=supabase_migrations -f '$dump' &&
         pg_restore -l '$dump' | awk '!/ public / || /DEFAULT ACL public |ACL - SCHEMA public /' > '$dump.list' &&
         pg_restore -U supabase_admin -d '${SCRATCH}' --exit-on-error --use-list='$dump.list' '$dump'"; then
      docker exec "$CONTAINER" rm -f "$dump" "$dump.list" || true
      return 0
    fi
    say "template copy failed (try ${try}/3)"
    admin_sql "drop database if exists \"${SCRATCH}\" with (force)" || true
    [ "$try" -lt 3 ] && { sleep 5; admin_sql "create database \"${SCRATCH}\" template template0 owner postgres"; }
  done
  docker exec "$CONTAINER" rm -f "$dump" "$dump.list" || true
  return 1
}

# The command runs in the background so a TERM or Ctrl-C reaches this script's
# trap at once instead of after the command finishes; cleanup stops it first.
CHILD=""
run() { "$@" & CHILD=$!; wait "$CHILD" || rc=$?; CHILD=""; }

cleanup() {
  if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null || true; wait "$CHILD" 2>/dev/null || true; fi
  if [ -n "$SCRATCH" ]; then
    admin_sql "drop database if exists \"${SCRATCH}\" with (force)" >/dev/null 2>&1 \
      || say "could not drop ${SCRATCH}; the next scratch run reaps it"
  fi
  release || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rc=0
case "$MODE" in
  lock)
    acquire || { say "could not take the local-stack lock within ${TIMEOUT}s"; exit 4; }
    run "$@"
    ;;
  reset-main)
    need_stack
    acquire || { say "could not take the local-stack lock within ${TIMEOUT}s"; exit 4; }
    run supabase db reset --db-url "$SB_MAIN_DB_URL" --yes
    ;;
  scratch)
    need_stack
    reap_scratch
    make_scratch || { say "could not build a scratch database"; exit 5; }
    export SB_SCRATCH_DB_URL; SB_SCRATCH_DB_URL=$(url "$SCRATCH")
    say "scratch database ${SCRATCH}"
    run "$@"
    ;;
esac
exit "$rc"
