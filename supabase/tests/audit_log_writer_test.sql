-- Issue #22: shared audit log writer.
-- Run with: supabase test db
begin;
select plan(8);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000221', 'Gala 2027', 2027, 'open');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000222', 'admin22@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000222', 'admin22@example.test');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000223', '00000000-0000-0000-0000-000000000221', 'Gold', 20000, 20000);

-- AC1: one row with actor, action, entity type, entity ID, before and after data.
select public.record_audit_log(
  '00000000-0000-0000-0000-000000000221',
  '00000000-0000-0000-0000-000000000222',
  'tier.update',
  'seating_tier',
  '00000000-0000-0000-0000-000000000223',
  '{"seat_price_cents": 20000}'::jsonb,
  '{"seat_price_cents": 25000}'::jsonb
);

select is(
  (select count(*)::int from public.audit_logs
    where entity_id = '00000000-0000-0000-0000-000000000223'),
  1,
  'the writer inserts exactly one row'
);

select row_eq(
  $$ select event_id, actor_id, action, entity_type, entity_id, before_data, after_data
       from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-000000000223' $$,
  row(
    '00000000-0000-0000-0000-000000000221'::uuid,
    '00000000-0000-0000-0000-000000000222'::uuid,
    'tier.update'::text,
    'seating_tier'::text,
    '00000000-0000-0000-0000-000000000223'::uuid,
    '{"seat_price_cents": 20000}'::jsonb,
    '{"seat_price_cents": 25000}'::jsonb
  ),
  'the row holds event, actor, action, entity type, entity ID, before and after data'
);

-- AC2: a change and its audit row in one transaction; the change fails, so
-- neither remains.
create function pg_temp.edit_tier_then_fail() returns void
language plpgsql as $$
begin
  update public.seating_tiers set seat_price_cents = 30000
   where id = '00000000-0000-0000-0000-000000000223';
  perform public.record_audit_log(
    '00000000-0000-0000-0000-000000000221',
    '00000000-0000-0000-0000-000000000222',
    'tier.update', 'seating_tier', '00000000-0000-0000-0000-000000000223',
    '{"seat_price_cents": 25000}'::jsonb, '{"seat_price_cents": 30000}'::jsonb
  );
  raise exception 'simulated failure after the audit write';
end;
$$;

select throws_ok(
  'select pg_temp.edit_tier_then_fail()',
  'simulated failure after the audit write',
  'the edit fails after writing its audit row'
);

select is(
  (select count(*)::int from public.audit_logs
    where entity_id = '00000000-0000-0000-0000-000000000223'),
  1,
  'the rolled-back edit adds no audit row (only the AC1 row remains)'
);

select is(
  (select seat_price_cents from public.seating_tiers
    where id = '00000000-0000-0000-0000-000000000223'),
  20000::bigint,
  'the rolled-back edit leaves the tier unchanged'
);

-- Same transaction, other direction: the audit write fails (unknown event,
-- foreign key violation), so the edit made before it must not stay either.
create function pg_temp.edit_tier_then_bad_audit() returns void
language plpgsql as $$
begin
  update public.seating_tiers set seat_price_cents = 40000
   where id = '00000000-0000-0000-0000-000000000223';
  perform public.record_audit_log(
    '00000000-0000-0000-0000-0000000002ff',
    '00000000-0000-0000-0000-000000000222',
    'tier.update', 'seating_tier', '00000000-0000-0000-0000-000000000223',
    '{"seat_price_cents": 20000}'::jsonb, '{"seat_price_cents": 40000}'::jsonb
  );
end;
$$;

select throws_ok(
  'select pg_temp.edit_tier_then_bad_audit()',
  '23503',
  null,
  'a failed audit write raises (foreign key violation)'
);

select is(
  (select seat_price_cents from public.seating_tiers
    where id = '00000000-0000-0000-0000-000000000223'),
  20000::bigint,
  'a failed audit write leaves the tier unchanged'
);

-- Only the server (service role) may call the writer.
select ok(
  not has_function_privilege('anon',
    'public.record_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.record_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)', 'execute')
  and has_function_privilege('service_role',
    'public.record_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)', 'execute'),
  'anon and authenticated cannot call the writer; service_role can'
);

select * from finish();
rollback;
