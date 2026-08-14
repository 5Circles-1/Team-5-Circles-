-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · seed — imported from the source workbook exactly as it stands.
-- 8 people · 6 departments · 40 charter duties · 28 KPI rows · 3 assigned
-- tasks · 3 example closes. Illustrative placeholder data by the workbook's
-- own admission; the Owner can clear it with app.reset_demo_data().
-- Run with the service key (RLS bypass): psql "$DB_URL" -f supabase/seed.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Settings (§20) ─────────────────────────────────────────────────────────
update public.settings set
  working_days_per_week  = 6,
  working_days_per_month = 26,
  window_open   = '18:00',
  window_close  = '19:30',
  grace_until   = '09:00',
  blocker_sla_hours = 24,
  peer_request_hours = 12,
  timezone      = 'Asia/Kolkata',
  weekly_off    = '{7}',
  diagnostic_until = current_date + 28   -- diagnostic mode: 28 days from first login
where id = 1;

-- ── Team Directory ─────────────────────────────────────────────────────────
insert into public.people
  (id, employee_code, full_name, department, designation, reports_to_id, email,
   access_role, capabilities, status, joined_on, daily_capacity_hours, wip_limit_p1)
values
  ('00000000-0000-4000-a000-000000000001','EMP-01','Arjun Desai','Management','Founder / CEO',
    null,'arjun@company.com','Owner','{}','Active','2024-01-01',8,3),
  ('00000000-0000-4000-a000-000000000002','EMP-02','Priya Nair','Sales','Sales Manager',
    '00000000-0000-4000-a000-000000000001','priya@company.com','Department Head','{}','Active','2024-03-01',8,3),
  ('00000000-0000-4000-a000-000000000003','EMP-03','Rohan Mehta','Sales','Sales Executive',
    '00000000-0000-4000-a000-000000000002','rohan@company.com','Member','{}','Active','2024-06-10',8,3),
  ('00000000-0000-4000-a000-000000000004','EMP-04','Ananya Sharma','Marketing','Performance Marketing Lead',
    '00000000-0000-4000-a000-000000000001','ananya@company.com','Department Head','{}','Active','2024-04-15',8,3),
  ('00000000-0000-4000-a000-000000000005','EMP-05','Kabir Singh','Marketing','Content & Social Executive',
    '00000000-0000-4000-a000-000000000004','kabir@company.com','Member','{}','Active','2024-09-02',8,3),
  ('00000000-0000-4000-a000-000000000006','EMP-06','Vikram Rao','Operations','Operations Executive',
    '00000000-0000-4000-a000-000000000001','vikram@company.com','Member','{}','Active','2024-05-20',8,3),
  ('00000000-0000-4000-a000-000000000007','EMP-07','Sneha Iyer','Finance','Accounts & Finance Executive',
    '00000000-0000-4000-a000-000000000001','sneha@company.com','Member','{finance_admin}','Active','2024-07-01',8,3),
  ('00000000-0000-4000-a000-000000000008','EMP-08','Meera Kapoor','HR','HR Generalist',
    '00000000-0000-4000-a000-000000000001','meera@company.com','Member','{hr_admin,people_admin}','Active','2024-08-12',8,3);

select setval('public.employee_code_seq', 8);

-- ── Role Charters ──────────────────────────────────────────────────────────
insert into public.charters (id, person_id, owns_outcome, can_decide_alone,
  needs_approval_from_id, needs_approval_for, reviewed_on) values
  ('00000000-0000-4000-b000-000000000002','00000000-0000-4000-a000-000000000002',
   'Monthly revenue target for the sales function; pipeline health; rep productivity',
   array['Discounts up to 10%','Lead reassignment between reps'],
   '00000000-0000-4000-a000-000000000001',
   array['Discounts above 10%','New pricing','Hiring'], current_date - 14),
  ('00000000-0000-4000-b000-000000000003','00000000-0000-4000-a000-000000000003',
   'Qualified pipeline created and revenue closed from own territory',
   array['Meeting scheduling','Standard proposal issue'],
   '00000000-0000-4000-a000-000000000002',
   array['Any discount','Custom payment terms','Scope changes'], current_date - 14),
  ('00000000-0000-4000-b000-000000000004','00000000-0000-4000-a000-000000000004',
   'Cost per qualified lead and volume of qualified leads from paid channels',
   array['Shifting budget between existing campaigns within monthly cap'],
   '00000000-0000-4000-a000-000000000001',
   array['Increasing total monthly budget','New channel','Brand messaging changes'], current_date - 14),
  ('00000000-0000-4000-b000-000000000005','00000000-0000-4000-a000-000000000005',
   'Organic reach, engagement and content output consistency',
   array['Post timing','Caption and hashtag choices'],
   '00000000-0000-4000-a000-000000000004',
   array['Brand voice changes','Paid boosting','Influencer tie-ups'], current_date - 14),
  ('00000000-0000-4000-b000-000000000006','00000000-0000-4000-a000-000000000006',
   'On-time, error-free delivery / fulfilment and turnaround time',
   array['Day-to-day scheduling','Standard replacements or redo'],
   '00000000-0000-4000-a000-000000000001',
   array['Vendor changes','Refunds above threshold','SOP changes'], current_date - 14),
  ('00000000-0000-4000-b000-000000000007','00000000-0000-4000-a000-000000000007',
   'Accurate books, on-time collections and compliance calendar',
   array['Routine payments already budgeted','Standard invoice issue'],
   '00000000-0000-4000-a000-000000000001',
   array['Any unbudgeted payment','Write-offs','Credit terms'], current_date - 14),
  ('00000000-0000-4000-b000-000000000008','00000000-0000-4000-a000-000000000008',
   'Time-to-hire, attendance discipline and employee query turnaround',
   array['Interview scheduling','Leave approvals within policy'],
   '00000000-0000-4000-a000-000000000001',
   array['Offers and salary','Policy exceptions','Terminations'], current_date - 14),
  ('00000000-0000-4000-b000-000000000001','00000000-0000-4000-a000-000000000001',
   'Overall business targets, capital allocation and team performance',
   array['Everything within approved budget and policy'],
   null, array[]::text[], current_date - 14);

insert into public.charter_tasks (charter_id, title, cadence, definition_of_done, weekday_mask, month_day, sort_order) values
  -- Priya Nair (Sales)
  ('00000000-0000-4000-b000-000000000002','Morning pipeline review with reps','Daily','All P1 deals reviewed; next action set on each',null,null,1),
  ('00000000-0000-4000-b000-000000000002','Deal-stage hygiene audit in CRM','Daily','Zero deals sitting >7 days without activity',null,null,2),
  ('00000000-0000-4000-b000-000000000002','Forecast update for the month','Weekly','Committed / Best-case / Pipeline split submitted to CEO','{5}',null,3),
  ('00000000-0000-4000-b000-000000000002','1-on-1 with each rep','Weekly','Notes logged; one coaching action agreed per rep','{1}',null,4),
  ('00000000-0000-4000-b000-000000000002','Win/loss review of closed deals','Monthly','Reasons tagged; 3 learnings circulated',null,28,5),
  -- Rohan Mehta (Sales)
  ('00000000-0000-4000-b000-000000000003','Follow up on all new inbound leads','Daily','Every lead contacted within 4 working hours; outcome logged in CRM',null,null,1),
  ('00000000-0000-4000-b000-000000000003','Outbound prospecting calls / mails','Daily','Minimum call and mail quota completed and logged',null,null,2),
  ('00000000-0000-4000-b000-000000000003','Update CRM for every conversation','Daily','No conversation older than 24h missing a note',null,null,3),
  ('00000000-0000-4000-b000-000000000003','Send proposals / quotations pending','Daily','Zero proposals pending beyond 48h of request',null,null,4),
  ('00000000-0000-4000-b000-000000000003','Clean up stale deals in own pipeline','Weekly','Every deal has a dated next step','{5}',null,5),
  -- Ananya Sharma (Marketing)
  ('00000000-0000-4000-b000-000000000004','Check campaign spend, CPL and pacing','Daily','All live campaigns reviewed; overspends paused',null,null,1),
  ('00000000-0000-4000-b000-000000000004','Review lead quality feedback from Sales','Daily','Junk leads tagged; targeting adjusted or flagged',null,null,2),
  ('00000000-0000-4000-b000-000000000004','Creative / copy testing rotation','Weekly','At least one new variant live per active campaign','{3}',null,3),
  ('00000000-0000-4000-b000-000000000004','Channel performance report','Weekly','Spend, leads, CPL, conversion by channel shared with CEO','{5}',null,4),
  ('00000000-0000-4000-b000-000000000004','Budget reallocation across channels','Monthly','Next month''s split proposed with rationale',null,26,5),
  -- Kabir Singh (Marketing)
  ('00000000-0000-4000-b000-000000000005','Publish scheduled posts across channels','Daily','All planned posts live as per calendar',null,null,1),
  ('00000000-0000-4000-b000-000000000005','Community / comment / DM response','Daily','Zero unanswered comments or DMs older than 24h',null,null,2),
  ('00000000-0000-4000-b000-000000000005','Content calendar for next week','Weekly','Calendar filled and approved before Friday EOD','{5}',null,3),
  ('00000000-0000-4000-b000-000000000005','Organic performance snapshot','Weekly','Reach, engagement, follower delta reported','{1}',null,4),
  ('00000000-0000-4000-b000-000000000005','Long-form content piece','Monthly','One blog / video / case study published',null,15,5),
  -- Vikram Rao (Operations)
  ('00000000-0000-4000-b000-000000000006','Process the day''s orders / service requests','Daily','All requests received before cut-off processed same day',null,null,1),
  ('00000000-0000-4000-b000-000000000006','Escalation and complaint resolution','Daily','Every open escalation has an owner and an ETA',null,null,2),
  ('00000000-0000-4000-b000-000000000006','Vendor / partner coordination check','Daily','Pending vendor items chased; status updated',null,null,3),
  ('00000000-0000-4000-b000-000000000006','Inventory / capacity check','Weekly','Shortfalls flagged at least 7 days in advance','{1}',null,4),
  ('00000000-0000-4000-b000-000000000006','Process SOP review and update','Monthly','One process documented or improved',null,20,5),
  -- Sneha Iyer (Finance)
  ('00000000-0000-4000-b000-000000000007','Record the day''s receipts and payments','Daily','Books tallied to bank balance at day end',null,null,1),
  ('00000000-0000-4000-b000-000000000007','Follow up on overdue invoices','Daily','Every invoice overdue >7 days chased and logged',null,null,2),
  ('00000000-0000-4000-b000-000000000007','Invoice issue against closed deals','Daily','Zero closed deals uninvoiced beyond 24h',null,null,3),
  ('00000000-0000-4000-b000-000000000007','Cash position and collections report','Weekly','Opening cash, inflow, outflow, closing, ageing shared','{5}',null,4),
  ('00000000-0000-4000-b000-000000000007','Statutory filings and reconciliations','Monthly','All dues filed before due date; zero penalties',null,7,5),
  -- Meera Kapoor (HR)
  ('00000000-0000-4000-b000-000000000008','Attendance and leave register update','Daily','Register updated and exceptions flagged same day',null,null,1),
  ('00000000-0000-4000-b000-000000000008','Candidate pipeline movement','Daily','Every active candidate moved a stage or contacted',null,null,2),
  ('00000000-0000-4000-b000-000000000008','Employee query / grievance response','Daily','No query pending beyond 24h without a response',null,null,3),
  ('00000000-0000-4000-b000-000000000008','Recruitment status report','Weekly','Open roles, stage-wise pipeline, expected joining dates','{5}',null,4),
  ('00000000-0000-4000-b000-000000000008','Payroll input preparation','Monthly','Attendance, leaves, deductions handed to Finance before cut-off',null,25,5),
  -- Arjun Desai (Management)
  ('00000000-0000-4000-b000-000000000001','Read and respond to EOD submissions','Daily','Every blocker raised has a response within 24h',null,null,1),
  ('00000000-0000-4000-b000-000000000001','Review key business numbers','Daily','Revenue, cash, leads, delivery status checked',null,null,2),
  ('00000000-0000-4000-b000-000000000001','Departmental review meeting','Weekly','Weekly Rollup reviewed with each department head','{1}',null,3),
  ('00000000-0000-4000-b000-000000000001','Targets and priority reset','Monthly','Next month''s KPI targets published to all',null,1,4),
  ('00000000-0000-4000-b000-000000000001','Strategy / planning block','Monthly','Quarter plan reviewed and adjusted',null,15,5);

-- ── KPI Targets (28 rows; weekly/monthly are computed, never stored) ───────
insert into public.kpis (person_id, metric, unit, target_type, direction, daily_target, review_cadence, is_primary, effective_from) values
  ('00000000-0000-4000-a000-000000000002','Team revenue closed','INR','Volume','Higher is better',40000,'Monthly',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000002','Qualified pipeline added','INR','Volume','Higher is better',120000,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000002','Deals with no activity >7 days','Count','Rate','Lower is better',0,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000003','New leads contacted','Count','Volume','Higher is better',25,'Daily',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000003','Meetings / demos booked','Count','Volume','Higher is better',3,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000003','Proposals sent','Count','Volume','Higher is better',2,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000003','Revenue closed','INR','Volume','Higher is better',15000,'Monthly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000004','Qualified leads generated','Count','Volume','Higher is better',20,'Weekly',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000004','Cost per qualified lead','INR','Rate','Lower is better',350,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000004','Ad spend utilisation vs plan','%','Rate','Higher is better',0.95,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000005','Posts published','Count','Volume','Higher is better',3,'Weekly',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000005','Engagement rate','%','Rate','Higher is better',0.04,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000005','Comments / DMs answered within 24h','%','Rate','Higher is better',1,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000006','Orders / requests processed','Count','Volume','Higher is better',40,'Daily',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000006','On-time delivery rate','%','Rate','Higher is better',0.98,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000006','Open escalations at day end','Count','Rate','Lower is better',0,'Daily',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000006','Average turnaround time','Hours','Rate','Lower is better',24,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000007','Collections received','INR','Volume','Higher is better',20000,'Monthly',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000007','Invoices overdue >30 days','Count','Rate','Lower is better',0,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000007','Books closed same day','%','Rate','Higher is better',1,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000007','Filings missed','Count','Rate','Lower is better',0,'Monthly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000008','Candidates moved a stage','Count','Volume','Higher is better',5,'Weekly',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000008','Time to hire','Days','Rate','Lower is better',30,'Monthly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000008','Queries answered within 24h','%','Rate','Higher is better',1,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000008','Unplanned attrition','Count','Rate','Lower is better',0,'Monthly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000001','EOD reports responded to','%','Rate','Higher is better',1,'Daily',true,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000001','Blockers cleared within 24h','%','Rate','Higher is better',1,'Weekly',false,'2026-08-01'),
  ('00000000-0000-4000-a000-000000000001','Company revenue','INR','Volume','Higher is better',100000,'Monthly',false,'2026-08-01');

-- ── Assigned Tasks ─────────────────────────────────────────────────────────
insert into public.tasks (id, task_code, title, owner_id, accountable_id, department,
  priority, status, assigned_by_id, assigned_on, due_at, task_type, visibility) values
  ('00000000-0000-4000-c000-000000000001','TSK-001','Rebuild the sales proposal template with new pricing',
   '00000000-0000-4000-a000-000000000003','00000000-0000-4000-a000-000000000001','Sales',
   'P2 - Important','On Track','00000000-0000-4000-a000-000000000001',
   '2026-08-09 10:00+05:30','2026-08-17 19:30+05:30','Assigned','Team'),
  ('00000000-0000-4000-c000-000000000002','TSK-002','Set up automated lead-source tagging in CRM',
   '00000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000001','Marketing',
   'P1 - Critical','At Risk','00000000-0000-4000-a000-000000000001',
   '2026-08-04 10:00+05:30','2026-08-13 19:30+05:30','Assigned','Team'),
  ('00000000-0000-4000-c000-000000000003','TSK-003','Document the order fulfilment SOP end to end',
   '00000000-0000-4000-a000-000000000006','00000000-0000-4000-a000-000000000001','Operations',
   'P3 - Nice to have','Not Started','00000000-0000-4000-a000-000000000001',
   '2026-08-12 10:00+05:30','2026-08-26 19:30+05:30','Assigned','Team');

select setval('public.task_code_seq', 3);

-- ── Daily EOD Log — the three example closes (2026-08-13) ──────────────────
insert into public.day_close (id, person_id, close_date, week_starting, month, department,
  fixed_tasks_due, fixed_tasks_done, primary_metric, target, direction, actual,
  assigned_on_track, assigned_at_risk, assigned_completed_today, reactive_hours,
  blocker, top_3_tomorrow, submitted_at, submitted_on_time,
  manager_reviewed, reviewed_by_id, reviewed_at) values
  ('00000000-0000-4000-d000-000000000001','00000000-0000-4000-a000-000000000003',
   '2026-08-13','2026-08-10','2026-08','Sales',5,5,'New leads contacted',25,'Higher is better',28,
   2,0,1,0.5,false,
   array['Close 2 pending proposals','Follow up ABC Ltd','20 outbound calls'],
   '2026-08-13 19:10+05:30',true,true,'00000000-0000-4000-a000-000000000002','2026-08-13 20:00+05:30'),
  ('00000000-0000-4000-d000-000000000002','00000000-0000-4000-a000-000000000004',
   '2026-08-13','2026-08-10','2026-08','Marketing',5,4,'Qualified leads generated',20,'Higher is better',14,
   1,1,0,2,true,
   array['Fix form','Relaunch paused campaign','Creative test on Set B'],
   '2026-08-13 19:20+05:30',true,true,'00000000-0000-4000-a000-000000000001','2026-08-13 20:05+05:30'),
  ('00000000-0000-4000-d000-000000000003','00000000-0000-4000-a000-000000000006',
   '2026-08-13','2026-08-10','2026-08','Operations',5,5,'Orders / requests processed',40,'Higher is better',37,
   2,0,1,1.5,false,
   array['Clear backlog of 3 orders','Vendor call at 11','SOP draft'],
   '2026-08-13 21:40+05:30',false,true,'00000000-0000-4000-a000-000000000001','2026-08-14 08:30+05:30');

-- Ananya's blocker from her close, exactly as the workbook records it
insert into public.blockers (id, raised_by_id, unblocker_id, day_close_id, description,
  severity, raised_at, sla_due_at) values
  ('00000000-0000-4000-e000-000000000001',
   '00000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000006',
   '00000000-0000-4000-d000-000000000002',
   'Landing page form broken since morning, leads not capturing',
   'High','2026-08-13 19:20+05:30','2026-08-14 19:20+05:30');

commit;
