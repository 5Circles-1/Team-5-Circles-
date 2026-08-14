-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · guard tests — structural invariants, run as superuser/service.
-- Every block raises 'TEST FAILED' if a forbidden write is allowed.
-- Run after migrations + seed:  psql -d pulse -f supabase/tests/01_guards_test.sql
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- 1 · Zero orphaned work: deactivating Vikram (owns TSK-003, is unblocker on
--     Ananya's blocker, holds 5 duties) must be structurally impossible.
do $$
begin
  begin
    update public.people set status = 'Deactivated' where full_name = 'Vikram Rao';
    raise exception 'TEST FAILED: deactivation with open footprint was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 1: deactivation blocked — %', sqlerrm;
  end;
end $$;

-- 2 · The duty ceiling: a 6th active fixed task is refused with the message.
do $$
declare cid uuid;
begin
  select id into cid from public.charters
   where person_id = (select id from public.people where full_name = 'Rohan Mehta');
  begin
    insert into public.charter_tasks (charter_id, title, cadence)
    values (cid, 'A sixth duty', 'Daily');
    raise exception 'TEST FAILED: sixth duty was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like 'Five is the ceiling%' then
      raise exception 'TEST FAILED: wrong ceiling message: %', sqlerrm;
    end if;
    raise notice 'PASS 2: duty ceiling holds — %', sqlerrm;
  end;
end $$;

-- 3 · The KPI ceiling: a 5th current KPI is refused.
do $$
declare pid uuid;
begin
  select id into pid from public.people where full_name = 'Rohan Mehta';
  begin
    insert into public.kpis (person_id, metric, unit, target_type, direction,
                             daily_target, review_cadence)
    values (pid, 'A fifth number', 'Count', 'Volume', 'Higher is better', 1, 'Weekly');
    raise exception 'TEST FAILED: fifth KPI was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 3: KPI ceiling holds — %', sqlerrm;
  end;
end $$;

-- 4 · Exactly one primary KPI per person.
do $$
declare pid uuid;
begin
  select id into pid from public.people where full_name = 'Rohan Mehta';
  begin
    update public.kpis set is_primary = true
     where person_id = pid and metric = 'Proposals sent';
    raise exception 'TEST FAILED: second primary KPI was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 4: one primary KPI enforced — %', sqlerrm;
  end;
end $$;

-- 5 · Targets are never overwritten in place.
do $$
begin
  begin
    update public.kpis set daily_target = 99
     where metric = 'New leads contacted' and effective_to is null;
    raise exception 'TEST FAILED: in-place target overwrite was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 5: target history protected — %', sqlerrm;
  end;
end $$;

-- 6 · Delegation depth: two hops maximum, the third is blocked with the message.
do $$
declare tid uuid := '00000000-0000-4000-c000-000000000001';
begin
  update public.tasks set owner_id = (select id from public.people where full_name = 'Priya Nair')
   where id = tid;                                   -- hop 1: Rohan → Priya
  update public.tasks set owner_id = (select id from public.people where full_name = 'Rohan Mehta')
   where id = tid;                                   -- hop 2: Priya → Rohan
  begin
    update public.tasks set owner_id = (select id from public.people where full_name = 'Priya Nair')
     where id = tid;                                 -- hop 3: refused
    raise exception 'TEST FAILED: third delegation hop was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    if sqlerrm not like 'This has moved twice already%' then
      raise exception 'TEST FAILED: wrong delegation message: %', sqlerrm;
    end if;
    raise notice 'PASS 6: delegation capped at two hops — %', sqlerrm;
  end;
end $$;

-- 7 · Completion is gated by reviewer sign-off.
do $$
declare tid uuid := '00000000-0000-4000-c000-000000000001';
begin
  insert into public.task_participants (task_id, person_id, support_role)
  values (tid, '00000000-0000-4000-a000-000000000002', 'Reviewer')
  on conflict do nothing;
  begin
    update public.tasks set status = 'Completed' where id = tid;
    raise exception 'TEST FAILED: completion with unsigned reviewer was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 7: reviewer gate holds — %', sqlerrm;
  end;
end $$;

-- 8 · Completion is gated by open approvals.
do $$
declare tid uuid := '00000000-0000-4000-c000-000000000003';
begin
  insert into public.approvals (requested_by_id, approver_id, subject_type, task_id, context)
  values ((select id from public.people where full_name = 'Vikram Rao'),
          (select id from public.people where full_name = 'Arjun Desai'),
          'task_approval', tid, 'SOP changes need sign-off');
  begin
    update public.tasks set status = 'Completed' where id = tid;
    raise exception 'TEST FAILED: completion with open approval was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 8: approval gate holds — %', sqlerrm;
  end;
  update public.approvals set decision = 'Approved', note = 'ok'
   where task_id = tid and decision = 'Pending';
end $$;

-- 9 · Blocked requires a linked open blocker — no anonymous blocking.
do $$
declare tid uuid := '00000000-0000-4000-c000-000000000003';
begin
  begin
    update public.tasks set status = 'Blocked' where id = tid;
    raise exception 'TEST FAILED: Blocked without a blocker was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 9: no anonymous blocking — %', sqlerrm;
  end;
end $$;

-- 10 · Dropped requires a reason.
do $$
declare tid uuid := '00000000-0000-4000-c000-000000000003';
begin
  begin
    update public.tasks set status = 'Dropped' where id = tid;
    raise exception 'TEST FAILED: drop without reason was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 10: drop needs a reason — %', sqlerrm;
  end;
end $$;

-- 11 · One Day Close per person per day.
do $$
begin
  begin
    insert into public.day_close (person_id, close_date, week_starting, month, department)
    values ('00000000-0000-4000-a000-000000000003', '2026-08-13', '2026-08-10', '2026-08', 'Sales');
    raise exception 'TEST FAILED: duplicate day close was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 11: one close per person per day — %', sqlerrm;
  end;
end $$;

-- 12 · Nothing is hard-deleted.
do $$
begin
  begin
    delete from public.tasks where task_code = 'TSK-003';
    raise exception 'TEST FAILED: hard delete was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 12: append-only holds — %', sqlerrm;
  end;
end $$;

-- 13 · Fixed-work spawn is idempotent (unique on charter task + date).
do $$
declare n1 int; n2 int; d date;
begin
  d := app.next_working_day(current_date);
  n1 := app.spawn_fixed_tasks(d);
  n2 := app.spawn_fixed_tasks(d);
  if n2 <> 0 then
    raise exception 'TEST FAILED: spawn not idempotent (second run created %)', n2;
  end if;
  raise notice 'PASS 13: spawn idempotent (% created, rerun 0)', n1;
end $$;

-- 14 · Subtasks nest one level only.
do $$
declare sub uuid;
begin
  insert into public.tasks (title, owner_id, accountable_id, department, assigned_by_id,
                            due_at, parent_task_id, assigned_on)
  values ('child', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002',
          'Sales', '00000000-0000-4000-a000-000000000002',
          now() + interval '2 days', '00000000-0000-4000-c000-000000000003', now())
  returning id into sub;
  begin
    insert into public.tasks (title, owner_id, accountable_id, department, assigned_by_id,
                              due_at, parent_task_id, assigned_on)
    values ('grandchild', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002',
            'Sales', '00000000-0000-4000-a000-000000000002',
            now() + interval '2 days', sub, now());
    raise exception 'TEST FAILED: two-level subtask was allowed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'PASS 14: subtasks one level deep — %', sqlerrm;
  end;
  update public.tasks set status = 'Dropped', drop_reason = 'test cleanup' where id = sub;
end $$;

select 'GUARD TESTS COMPLETE' as result;
