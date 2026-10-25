import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../.claude/bin/super-board-local-db.sh", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  readFileSync(join(repo, ".claude/super-board/configs/ssfgala.json"), "utf8"),
) as { verify_commands: string[] };

function run(args: string[], env: Record<string, string> = {}, cwd = repo) {
  return track(spawn(script, args, { cwd, env: { ...process.env, ...env } }));
}
// Attach at spawn time: a child that exits before anyone awaits it (reset-main
// exits 5 at once on CI, with no local stack) must still resolve.
const exits = new WeakMap<ReturnType<typeof spawn>, Promise<number>>();
function track(child: ReturnType<typeof spawn>) {
  exits.set(child, new Promise<number>((done) => child.on("exit", (code, signal) => done(code ?? (signal ? 128 : 1)))));
  return child;
}
function exited(child: ReturnType<typeof spawn>) {
  return exits.get(child)!;
}
async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}
function freshLock() {
  return join(mkdtempSync(join(tmpdir(), "sb-lock-")), "local-stack.lock");
}

describe("local-stack lock", () => {
  it("makes a second caller wait for the holder, then run", async () => {
    const lock = freshLock();
    const log = join(tmpdir(), `sb-lock-log-${process.pid}-${Date.now()}`);
    const env = { SB_LOCAL_STACK_LOCK: lock };
    const a = run(["lock", "--", "sh", "-c", `echo a-start >> ${log}; sleep 2; echo a-end >> ${log}`], env);
    await until(() => existsSync(join(lock, "pid")));
    const b = run(["lock", "--", "sh", "-c", `echo b >> ${log}`], env);
    expect(await exited(a)).toBe(0);
    expect(await exited(b)).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["a-start", "a-end", "b"]);
    expect(existsSync(lock)).toBe(false);
  });

  it("gives up with exit 4 when a live holder keeps it past --timeout", async () => {
    const lock = freshLock();
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid));
    writeFileSync(join(lock, "host"), hostname());
    writeFileSync(join(lock, "at"), String(Math.floor(Date.now() / 1000)));
    const b = run(["lock", "--timeout", "1", "--", "true"], { SB_LOCAL_STACK_LOCK: lock });
    expect(await exited(b)).toBe(4);
    expect(existsSync(lock)).toBe(true);
  });

  it("reaps a lock whose holder died", async () => {
    const lock = freshLock();
    const dead = spawnSync("sh", ["-c", "echo $$"]).stdout.toString().trim();
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), dead);
    writeFileSync(join(lock, "host"), hostname());
    writeFileSync(join(lock, "at"), String(Math.floor(Date.now() / 1000)));
    const b = run(["lock", "--timeout", "5", "--", "true"], { SB_LOCAL_STACK_LOCK: lock });
    expect(await exited(b)).toBe(0);
  });

  it("makes reset-main wait for a live holder and not reset (exit 4 on timeout)", async () => {
    const lock = freshLock();
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid));
    writeFileSync(join(lock, "host"), hostname());
    writeFileSync(join(lock, "at"), String(Math.floor(Date.now() / 1000)));
    // A fake `supabase` first on PATH records whether a reset ran.
    const bin = mkdtempSync(join(tmpdir(), "sb-fake-"));
    const marker = join(bin, "reset-ran");
    writeFileSync(join(bin, "supabase"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    const r = run(["reset-main", "--timeout", "2"], { SB_LOCAL_STACK_LOCK: lock, PATH: `${bin}:${process.env.PATH}` });
    const code = await exited(r);
    // 5 = local stack not running (CI); otherwise it must have waited and given up.
    expect([4, 5]).toContain(code);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(lock)).toBe(true);
  });

  it("runs reset-main once the holder releases the lock", async () => {
    const lock = freshLock();
    const bin = mkdtempSync(join(tmpdir(), "sb-fake-"));
    const log = join(bin, "order");
    writeFileSync(join(bin, "supabase"), `#!/bin/sh\necho "reset $*" >> ${log}\n`, { mode: 0o755 });
    const env = { SB_LOCAL_STACK_LOCK: lock, PATH: `${bin}:${process.env.PATH}` };
    const a = run(["lock", "--", "sh", "-c", `echo e2e-start >> ${log}; sleep 2; echo e2e-end >> ${log}`], env);
    await until(() => existsSync(join(lock, "pid")));
    const b = run(["reset-main"], env);
    expect(await exited(a)).toBe(0);
    const code = await exited(b);
    if (code === 5) return; // no local stack here (CI): the wait/timeout test above covers the lock
    expect(code).toBe(0);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.slice(0, 2)).toEqual(["e2e-start", "e2e-end"]);
    expect(lines[2]).toMatch(/^reset db reset --db-url postgresql:\/\/postgres:postgres@localhost:\d+\/postgres\?sslmode=disable --yes$/);
    expect(existsSync(lock)).toBe(false);
  });

  it("lets exactly one of two waiters racing to reap a dead holder's lock hold it", async () => {
    const lock = freshLock();
    const dead = spawnSync("sh", ["-c", "echo $$"]).stdout.toString().trim();
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), dead);
    writeFileSync(join(lock, "host"), hostname());
    writeFileSync(join(lock, "at"), String(Math.floor(Date.now() / 1000)));
    const log = join(tmpdir(), `sb-lock-race-${process.pid}-${Date.now()}`);
    // The pause holds each waiter between judging the lock dead and reaping it.
    // b reaps a second later, while a already holds a fresh lock: the race from #92.
    const env = (pause: string) => ({ SB_LOCAL_STACK_LOCK: lock, SB_LOCK_REAP_PAUSE: pause });
    const body = (id: string) => `echo start-${id} >> ${log}; sleep 2; echo end-${id} >> ${log}`;
    const a = run(["lock", "--timeout", "20", "--", "sh", "-c", body("a")], env("1"));
    const b = run(["lock", "--timeout", "20", "--", "sh", "-c", body("b")], env("2"));
    expect(await exited(a)).toBe(0);
    expect(await exited(b)).toBe(0);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    // Never two holders at once: each start is followed by its own end.
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(lines[0].replace("start", "end"));
    expect(lines[3]).toBe(lines[2].replace("start", "end"));
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(join(lock, "..")).filter((f) => f !== "local-stack.lock")).toEqual([]);
  }, 30_000);

  it("reaps a lock with no pid file older than the grace period", async () => {
    const lock = freshLock();
    mkdirSync(lock);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const b = run(["lock", "--timeout", "5", "--", "true"], { SB_LOCAL_STACK_LOCK: lock });
    expect(await exited(b)).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  it("does not reap a lock with no pid file inside the grace period", async () => {
    const lock = freshLock();
    mkdirSync(lock);
    const b = run(["lock", "--timeout", "1", "--", "true"], { SB_LOCAL_STACK_LOCK: lock });
    expect(await exited(b)).toBe(4);
    expect(existsSync(lock)).toBe(true);
  });

  it("releases the lock when the command fails", async () => {
    const lock = freshLock();
    expect(await exited(run(["lock", "--", "sh", "-c", "exit 3"], { SB_LOCAL_STACK_LOCK: lock }))).toBe(3);
    expect(existsSync(lock)).toBe(false);
  });

  it("releases the lock and stops the command when interrupted", async () => {
    const lock = freshLock();
    const marker = join(tmpdir(), `sb-lock-marker-${process.pid}-${Date.now()}`);
    const a = run(["lock", "--", "sh", "-c", `sleep 3; touch ${marker}`], { SB_LOCAL_STACK_LOCK: lock });
    await until(() => existsSync(join(lock, "pid")));
    a.kill("SIGTERM");
    expect(await exited(a)).toBe(143);
    expect(existsSync(lock)).toBe(false);
    await new Promise((r) => setTimeout(r, 3500));
    expect(existsSync(marker)).toBe(false);
  });
});

// These need the local stack (`supabase start`) and write a canary row to the
// main local database, so they are opt-in: SB_LOCAL_DB_TESTS=1.
const container = "supabase_db_ssfGala";
const stackTests = process.env.SB_LOCAL_DB_TESTS === "1";

function sql(query: string, db = "postgres") {
  const r = spawnSync("docker", ["exec", container, "psql", "-qAt", "-U", "supabase_admin", "-d", db, "-c", query]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}
const scratchCount = () => Number(sql("select count(*) from pg_database where datname like 'sb\\_scratch\\_%'"));

// A copy of this repo's supabase/ folder plus one migration and one pgTAP test
// of its own, as a lane's worktree would have.
function laneRepo(lane: string, other: string) {
  const dir = mkdtempSync(join(tmpdir(), `sb-lane-${lane}-`));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  cpSync(join(repo, "supabase"), join(dir, "supabase"), { recursive: true });
  cpSync(join(repo, ".claude/bin"), join(dir, ".claude/bin"), { recursive: true });
  writeFileSync(join(dir, `supabase/migrations/29991231000000_lane_${lane}.sql`), `create table public.lane_${lane} (id int);\nalter table public.lane_${lane} enable row level security;\n`);
  writeFileSync(
    join(dir, `supabase/tests/zz_lane_${lane}_test.sql`),
    `begin;\nselect plan(2);\nselect has_table('public', 'lane_${lane}', 'own migration applied');\nselect hasnt_table('public', 'lane_${other}', 'other lane absent');\nselect * from finish();\nrollback;\n`,
  );
  return dir;
}

describe.skipIf(!stackTests)("scratch databases (needs the local stack)", () => {
  it(
    "gate reset and two lanes' pgTAP run at once on their own migrations; main rows untouched",
    async () => {
      const token = `canary-${Date.now()}`;
      sql("create table if not exists public.sb_local_db_canary (token text)");
      sql(`insert into public.sb_local_db_canary values ('${token}')`);
      const before = scratchCount();
      const pgtap =
        'supabase db reset --db-url "$SB_SCRATCH_DB_URL" --yes && supabase test db --db-url "$SB_SCRATCH_DB_URL"';
      const gateReset = config.verify_commands.find((c) => c.includes("db reset"))!;

      const a = laneRepo("a", "b");
      const b = laneRepo("b", "a");
      const gate = exited(track(spawn("sh", ["-c", gateReset], { cwd: laneRepo("gate", "none"), stdio: "ignore" })));
      const lanes = [a, b].map((cwd) => {
        const child = run(["scratch", "--", "sh", "-c", pgtap], {}, cwd);
        let out = "";
        child.stdout?.on("data", (d) => (out += d));
        return exited(child).then((code) => ({ code, out }));
      });
      const [ra, rb] = await Promise.all(lanes);
      expect(await gate).toBe(0);
      expect(ra.code).toBe(0);
      expect(rb.code).toBe(0);
      expect(ra.out).toContain("zz_lane_a_test.sql");
      expect(rb.out).toContain("zz_lane_b_test.sql");
      expect(sql(`select count(*) from public.sb_local_db_canary where token = '${token}'`)).toBe("1");
      expect(sql("select to_regclass('public.lane_a') is null and to_regclass('public.lane_b') is null")).toBe("t");
      expect(scratchCount()).toBe(before);
      sql("drop table public.sb_local_db_canary");
    },
    300_000,
  );

  it("gate reset applies every repo migration to the scratch database, not to main", async () => {
    const files = readdirSync(join(repo, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length;
    const mainBefore = sql("select count(*) from supabase_migrations.schema_migrations");
    const gateReset = config.verify_commands.find((c) => c.includes("db reset"))!;
    // The gate's own command, then a count of the migrations it recorded in the scratch db.
    const count =
      'db=${SB_SCRATCH_DB_URL##*/}; db=${db%%\\?*}; echo "db=$db"; ' +
      'docker exec supabase_db_ssfGala psql -qAt -U supabase_admin -d "$db" -c "select count(*) from supabase_migrations.schema_migrations"';
    const inner = gateReset.replace(/' *$/, `; ${count.replace(/'/g, "'\\''")}'`);
    const r = spawnSync("sh", ["-c", inner], { cwd: repo });
    expect(r.status).toBe(0);
    const out = r.stdout.toString();
    expect(out).toMatch(/db=sb_scratch_\d+_\d+/);
    expect(out.trim().split("\n").at(-1)).toBe(String(files));
    expect(sql("select count(*) from supabase_migrations.schema_migrations")).toBe(mainBefore);
  }, 180_000);

  it("a broken migration fails the scratch reset and leaves main alone", async () => {
    const dir = laneRepo("broken", "none");
    writeFileSync(join(dir, "supabase/migrations/29991231000001_broken.sql"), "create table public.nope (id int references public.missing(id));\n");
    const r = spawnSync(script, ["scratch", "--", "sh", "-c", 'supabase db reset --db-url "$SB_SCRATCH_DB_URL" --yes'], { cwd: dir });
    expect(r.status).not.toBe(0);
    expect(sql("select to_regclass('public.lane_broken') is null")).toBe("t");
  }, 180_000);

  it("reaps a scratch database abandoned past --stale-after", async () => {
    const old = `sb_scratch_${Math.floor(Date.now() / 1000) - 100}_1`;
    sql(`create database "${old}"`);
    expect(await exited(run(["scratch", "--stale-after", "10", "--", "true"]))).toBe(0);
    expect(sql(`select count(*) from pg_database where datname = '${old}'`)).toBe("0");
  }, 120_000);

  it("drops the scratch database when the command fails or is interrupted", async () => {
    const before = scratchCount();
    expect(await exited(run(["scratch", "--", "sh", "-c", "exit 7"]))).toBe(7);
    expect(scratchCount()).toBe(before);

    const child = run(["scratch", "--", "sleep", "30"]);
    await until(() => scratchCount() > before, 60_000);
    child.kill("SIGINT");
    expect(await exited(child)).toBe(130);
    expect(scratchCount()).toBe(before);
  }, 120_000);
});

describe("standalone super-qa", () => {
  it("runs every e2e step under the local-stack lock", () => {
    const files = [".claude/skills/super-qa/SKILL.md", ".claude/skills/super-qa/references/iteration-preamble.md"];
    const runs = files.flatMap((f) =>
      readFileSync(join(repo, f), "utf8")
        .split("\n")
        .filter((l) => l.includes("npx playwright test e2e/")),
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) expect(line).toContain("super-board-local-db.sh lock -- npx playwright test");
  });
});
