# QA v1 for issue 55
Method: all migrations applied to a scratch database (qa55) on the local Supabase Postgres 17 container, then every file in supabase/tests run with psql (pgTAP). `supabase test db` was not used because it needs the shared local DB reset.
- AC1 audit_logs UPDATE/DELETE rejected for service role: tests 1-2 in append_only_history_test.sql, SQLSTATE 23001.
- AC2 payments and payment_allocations DELETE rejected: tests 3-6 plus updated edges test.
- AC3 payments.status update still succeeds: lives_ok in append_only_history_test.sql.
- AC4 pgTAP suite: see pgtap.log. All 9 files, 112 tests ok, 0 not ok.
- Extra: no FK on the three tables uses cascade or set null, so no parent delete can silently hit the triggers.
