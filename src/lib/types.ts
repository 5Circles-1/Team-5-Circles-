/**
 * Domain types. The enum string unions are copied verbatim from the Postgres
 * enums (supabase/migrations/00001), which come from the workbook's Lists tab.
 * These are the exact words the UI shows — never the engineering terms (§2).
 */

export type Department =
  | 'Sales' | 'Marketing' | 'Operations' | 'Finance' | 'HR' | 'Management';

export type Cadence = 'Daily' | 'Weekly' | 'Fortnightly' | 'Monthly' | 'Quarterly';

export type TaskStatus =
  | 'Awaiting Acceptance' | 'Declined' | 'Not Started' | 'On Track' | 'At Risk'
  | 'Blocked' | 'Pending Review' | 'Completed' | 'Dropped' | 'Missed';

export type Priority = 'P1 - Critical' | 'P2 - Important' | 'P3 - Nice to have';

export type TargetType = 'Volume' | 'Rate';

export type Direction = 'Higher is better' | 'Lower is better';

export type TaskType = 'Fixed' | 'Assigned' | 'Reactive';

export type SupportRole = 'Support' | 'Reviewer' | 'Approver' | 'Watcher';

export type AccessRole =
  | 'Owner' | 'Department Head' | 'Team Lead' | 'Member' | 'Restricted' | 'Observer';

export type PersonStatus = 'Active' | 'On Leave' | 'Deactivated';

export type TaskVisibility = 'Team' | 'Department' | 'Private';

export type KpiUnit = 'INR' | 'Count' | '%' | 'Hours' | 'Days';

export type AssignmentVerb =
  | 'Direct' | 'Peer Request' | 'Cross-department Request' | 'Ask';

export type ApprovalDecision = 'Pending' | 'Approved' | 'Declined' | 'Question';

export type BlockerSeverity = 'Low' | 'Medium' | 'High';

export type Capability = 'hr_admin' | 'finance_admin' | 'people_admin';

export const DEPARTMENTS: Department[] =
  ['Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'Management'];

export const TASK_STATUSES: TaskStatus[] = [
  'Awaiting Acceptance', 'Declined', 'Not Started', 'On Track', 'At Risk',
  'Blocked', 'Pending Review', 'Completed', 'Dropped', 'Missed',
];

export const PRIORITIES: Priority[] =
  ['P1 - Critical', 'P2 - Important', 'P3 - Nice to have'];

// ── Row shapes (subset of columns the app reads; see migrations for truth) ──

export interface Person {
  id: string;
  employee_code: string;
  full_name: string;
  department: Department;
  designation: string;
  reports_to_id: string | null;
  email: string;
  phone: string | null;
  access_role: AccessRole;
  capabilities: Capability[];
  status: PersonStatus;
  joined_on: string | null;
  deactivated_on: string | null;
  daily_capacity_hours: number;
  wip_limit_p1: number;
  settling_in_until: string | null;
}

export interface CharterTask {
  id: string;
  charter_id: string;
  title: string;
  cadence: Cadence;
  definition_of_done: string | null;
  weekday_mask: number[] | null;
  month_day: number | null;
  active: boolean;
  suspended_reason: string | null;
  sort_order: number;
}

export interface Charter {
  id: string;
  person_id: string;
  owns_outcome: string | null;
  can_decide_alone: string[];
  needs_approval_from_id: string | null;
  needs_approval_for: string[];
  reviewed_on: string | null;
  next_review_due: string | null;
}

export interface Kpi {
  id: string;
  person_id: string;
  metric: string;
  unit: KpiUnit;
  target_type: TargetType;
  direction: Direction;
  daily_target: number;
  review_cadence: Cadence;
  is_primary: boolean;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
}

export interface Task {
  id: string;
  task_code: string;
  title: string;
  description: string | null;
  checklist: { text: string; done: boolean }[];
  task_type: TaskType;
  owner_id: string;
  accountable_id: string;
  department: Department;
  priority: Priority;
  status: TaskStatus;
  assigned_by_id: string;
  assigned_on: string;
  due_at: string;
  est_hours: number | null;
  started_at: string | null;
  completed_at: string | null;
  linked_kpi_id: string | null;
  parent_task_id: string | null;
  source_charter_task_id: string | null;
  spawn_date: string | null;
  visibility: TaskVisibility;
  acceptance_required: boolean;
  accepted_at: string | null;
  declined_reason: string | null;
  origin_verb: AssignmentVerb;
  pending_with_id: string | null;
  respond_by: string | null;
  proposed_due_at: string | null;
  proposed_owner_id: string | null;
  counter_note: string | null;
  delegation_chain: string[];
  batch_id: string | null;
  urgent: boolean;
  override_reason: string | null;
  drop_reason: string | null;
}

export interface TaskParticipant {
  id: string;
  task_id: string;
  person_id: string;
  support_role: SupportRole;
  added_by_id: string | null;
  added_at: string;
  acknowledged_at: string | null;
  signed_off_at: string | null;
  removed_at: string | null;
  removed_reason: string | null;
}

export interface DayClose {
  id: string;
  person_id: string;
  close_date: string;
  week_starting: string;
  month: string;
  department: Department;
  fixed_tasks_due: number;
  fixed_tasks_done: number;
  fixed_done_task_ids: string[];
  primary_metric: string | null;
  target: number | null;
  direction: Direction | null;
  actual: number | null;
  assigned_on_track: number;
  assigned_at_risk: number;
  assigned_completed_today: number;
  reactive_hours: number;
  reactive_tags: string[];
  blocker: boolean;
  top_3_tomorrow: string[];
  submitted_at: string;
  submitted_on_time: boolean;
  edited_at: string | null;
  manager_reviewed: boolean;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
}

export interface Blocker {
  id: string;
  raised_by_id: string;
  unblocker_id: string;
  task_id: string | null;
  day_close_id: string | null;
  description: string;
  severity: BlockerSeverity;
  raised_at: string;
  sla_due_at: string;
  first_response_at: string | null;
  first_responder_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  nudged_at: string | null;
  escalated_at: string | null;
  escalated_to_id: string | null;
}

export interface Settings {
  working_days_per_week: number;
  working_days_per_month: number;
  window_open: string;    // '18:00:00'
  window_close: string;   // '19:30:00'
  grace_until: string;    // '09:00:00'
  blocker_sla_hours: number;
  peer_request_hours: number;
  diagnostic_until: string | null;
  timezone: string;
  weekly_off: number[];
  product_name: string;
}
