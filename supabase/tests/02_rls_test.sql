-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · RLS tests — each forbidden read and write attempted as a real
-- session (role authenticated + JWT sub), per §18. Matches §17 Access tests:
-- the direct API call is rejected by RLS, not only by the UI.
-- Run after 01_guards_test.sql:  psql -d pulse -f supabase/tests/02_rls_test.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Give every person an auth identity (the link trigger wires auth_user_id).
insert into auth.users (id, email)
select gen_random_uuid(), email from public.people
on conflict (email) do nothing;

-- An Observer (investor) and a Restricted contractor for the scope tests.
insert into public.people (full_name, department, designation, reports_to_id, email, access_role)
values ('Iris Investor', 'Management', 'Investor', '00000000-0000-4000-a000-000000000001',
        'iris@fund.example', 'Observer')
on conflict do nothing;
insert into public.people (full_name, department, designation, reports_to_id, email, access_role)
values ('Casey Contractor', 'Marketing', 'Agency designer', '00000000-0000-4000-a000-000000000004',
        'casey@agency.example', 'Restricted')
on conflict do nothing;
insert into auth.users (id, email)
select gen_random_uuid(), email from public.people where auth_user_id is null
on conflict (email) do nothing;

create or replace function pg_temp.login(p_email text) returns void
language plpgsql as $$
declare uid uuid;
begin
  select u.id into uid from auth.users u where lower(u.email) = lower(p_email);
  perform set_config('request.jwt.claim.sub', uid::text, false);
end $$;

-- ── Test A1 (§17.1): Rohan cannot assign onto Kabir's board directly ───────
select pg_temp.login('rohan@company.com');
set role authenticated;
do $$
begin
  begin
    insert into public.tasks (title, owner_id, accountable_id, department, assigned_by_id,
                              due_at, status, assigned_on)
    values ('Sneaky direct assign', '00000000-0000-4000-a000-000000000005',
            app.current_person_id(), 'Marketing', app.current_person_id(),
            now() + interval '2 days', 'Not Started', now());
    raise exception 'TEST FAILED: Rohan direct-assigned to Kabir';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS A1: cross-dept direct assign refused — %', sqlerrm;
  end;
end $$;
reset role;

-- ── Test A2: Meera (Member + hr_admin) sees leave, not commercial KPIs ─────
select pg_temp.login('meera@company.com');
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.leaves;   -- hr_admin: leave across departments
  raise notice 'PASS A2a: hr_admin reads leaves (% rows)', n;
  select count(*) into n from public.kpis k
   where k.person_id = '00000000-0000-4000-a000-000000000007'; -- Sneha's Finance KPIs
  if n > 0 then
    raise exception 'TEST FAILED: hr_admin can read another department''s KPI values';
  end if;
  raise notice 'PASS A2b: hr_admin sees no commercial KPI values';
end $$;
reset role;

-- ── Test A3: Observer finds no personal rows anywhere ──────────────────────
select pg_temp.login('iris@fund.example');
set role authenticated;
do $$
declare n int; total int := 0;
begin
  select count(*) into n from public.people where id <> app.current_person_id(); total := total + n;
  select count(*) into n from public.tasks; total := total + n;
  select count(*) into n from public.day_close; total := total + n;
  select count(*) into n from public.blockers; total := total + n;
  select count(*) into n from public.comments; total := total + n;
  select count(*) into n from public.day_close_status; total := total + n;
  if total > 0 then
    raise exception 'TEST FAILED: Observer can see % individual rows', total;
  end if;
  raise notice 'PASS A3: Observer sees rollup-material only (0 individual rows)';
end $$;
reset role;

-- ── Test A4: Restricted contractor sees only their own footprint ───────────
select pg_temp.login('casey@agency.example');
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.tasks;
  if n > 0 then raise exception 'TEST FAILED: Restricted sees others'' tasks (%)', n; end if;
  select count(*) into n from public.people where id <> app.current_person_id();
  if n > 0 then raise exception 'TEST FAILED: Restricted sees the directory (%)', n; end if;
  select count(*) into n from public.day_close_status;
  if n > 0 then raise exception 'TEST FAILED: Restricted sees close statuses (%)', n; end if;
  raise notice 'PASS A4: Restricted scope holds';
end $$;
reset role;

-- ── Test A5: Day Close text is manager-chain only ──────────────────────────
select pg_temp.login('kabir@company.com');
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.day_close
   where person_id = '00000000-0000-4000-a000-000000000003'; -- Rohan's close (Sales)
  if n > 0 then raise exception 'TEST FAILED: Kabir reads Rohan''s close'; end if;
  select count(*) into n from public.day_close_status
   where person_id = '00000000-0000-4000-a000-000000000004'; -- Ananya, own dept: status ok
  if n = 0 then raise exception 'TEST FAILED: same-dept close status hidden'; end if;
  raise notice 'PASS A5: close text gated to chain; status visible in-department';
end $$;
reset role;

select pg_temp.login('priya@company.com');
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.day_close
   where person_id = '00000000-0000-4000-a000-000000000003';
  if n = 0 then raise exception 'TEST FAILED: Priya cannot read her report''s close'; end if;
  raise notice 'PASS A5b: manager reads their report''s full close';
end $$;
reset role;

-- ── Test A6: blocker text is not gossip ────────────────────────────────────
select pg_temp.login('priya@company.com');  -- manages neither Ananya nor Vikram
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.blockers;
  if n > 0 then raise exception 'TEST FAILED: Priya reads a blocker she is not party to'; end if;
  raise notice 'PASS A6: blocker visibility limited to parties, their chains, Owner';
end $$;
reset role;

select pg_temp.login('vikram@company.com');  -- the named unblocker
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.blockers;
  if n = 0 then raise exception 'TEST FAILED: unblocker cannot see the blocker'; end if;
  raise notice 'PASS A6b: unblocker sees the blocker aimed at them';
end $$;
reset role;

-- ── Test A7: charters are not editable sideways ────────────────────────────
select pg_temp.login('rohan@company.com');
set role authenticated;
do $$
begin
  begin
    update public.charters set owns_outcome = 'everything'
     where person_id = '00000000-0000-4000-a000-000000000002';
    if not found then
      raise notice 'PASS A7: Rohan cannot touch Priya''s charter (row invisible)';
    else
      raise exception 'TEST FAILED: Rohan edited Priya''s charter';
    end if;
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS A7: Rohan cannot touch Priya''s charter — %', sqlerrm;
  end;
end $$;
reset role;

-- ── Test A8: nobody submits someone else's Day Close ───────────────────────
select pg_temp.login('rohan@company.com');
set role authenticated;
do $$
begin
  begin
    insert into public.day_close (person_id, close_date, week_starting, month, department)
    values ('00000000-0000-4000-a000-000000000002', current_date,
            app.week_start(current_date), to_char(current_date,'YYYY-MM'), 'Sales');
    raise exception 'TEST FAILED: Rohan filed Priya''s close';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS A8: closes are first-person only — %', sqlerrm;
  end;
end $$;
reset role;

-- ── Test A9: peer/cross-dept requests cannot skip Awaiting Acceptance ──────
select pg_temp.login('rohan@company.com');
set role authenticated;
do $$
declare tid uuid;
begin
  insert into public.tasks (title, owner_id, accountable_id, department, assigned_by_id,
                            due_at, status, assigned_on)
  values ('Please pull CRM export for my pipeline review',
          '00000000-0000-4000-a000-000000000006', app.current_person_id(), 'Operations',
          app.current_person_id(), now() + interval '3 days', 'Awaiting Acceptance', now())
  returning id into tid;
  if (select status from public.tasks where id = tid) <> 'Awaiting Acceptance' then
    raise exception 'TEST FAILED: request did not land as Awaiting Acceptance';
  end if;
  if (select pending_with_id from public.tasks where id = tid)
     <> '00000000-0000-4000-a000-000000000001' then
    -- Vikram reports to Arjun; Operations has no Department Head, so the
    -- cross-department request routes to the Owner as fallback head.
    raise exception 'TEST FAILED: cross-dept request not routed to the department head';
  end if;
  raise notice 'PASS A9: request lands as Awaiting Acceptance, routed to the head';
  update public.tasks set status = 'Dropped', drop_reason = 'test cleanup' where id = tid;
end $$;
reset role;

reset all;
select 'RLS TESTS COMPLETE' as result;
