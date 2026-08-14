/**
 * Zod on every input boundary (§3). Server actions parse with these before
 * touching the database; react-hook-form uses the same schemas client-side.
 */
import { z } from 'zod';

export const uuid = z.string().uuid();

export const priorityEnum = z.enum(['P1 - Critical', 'P2 - Important', 'P3 - Nice to have']);
export const visibilityEnum = z.enum(['Team', 'Department', 'Private']);
export const supportRoleEnum = z.enum(['Support', 'Reviewer', 'Approver', 'Watcher']);
export const severityEnum = z.enum(['Low', 'Medium', 'High']);
export const cadenceEnum = z.enum(['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly']);
export const departmentEnum = z.enum(['Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'Management']);
export const accessRoleEnum = z.enum(['Owner', 'Department Head', 'Team Lead', 'Member', 'Restricted', 'Observer']);
export const directionEnum = z.enum(['Higher is better', 'Lower is better']);
export const targetTypeEnum = z.enum(['Volume', 'Rate']);
export const kpiUnitEnum = z.enum(['INR', 'Count', '%', 'Hours', 'Days']);

export const assignTaskSchema = z.object({
  title: z.string().trim().min(3, 'Give it a real title').max(200),
  description: z.string().max(8000).optional().default(''),
  owner_ids: z.array(uuid).min(1, 'Pick at least one owner').max(20),
  priority: priorityEnum.default('P2 - Important'),
  due_at: z.string().datetime({ offset: true }),
  est_hours: z.coerce.number().positive().max(200).optional(),
  visibility: visibilityEnum.default('Team'),
  linked_kpi_id: uuid.optional(),
  parent_task_id: uuid.optional(),
  support: z.array(z.object({ person_id: uuid, role: supportRoleEnum })).max(12).default([]),
  /** §6.4: a fired guard is overridden only with a recorded reason. */
  override_reason: z.string().max(500).optional(),
  acknowledged_guards: z.array(z.string()).default([]),
});
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

export const respondToRequestSchema = z.object({
  task_id: uuid,
  response: z.enum(['accept', 'decline', 'counter']),
  declined_reason: z.string().max(500).optional(),
  proposed_due_at: z.string().datetime({ offset: true }).optional(),
  proposed_owner_id: uuid.optional(),
  counter_note: z.string().max(500).optional(),
}).refine((v) => v.response !== 'decline' || (v.declined_reason ?? '').trim().length > 0, {
  message: 'Decline needs a reason — it returns to the sender with it.',
  path: ['declined_reason'],
});

export const taskStatusChangeSchema = z.object({
  task_id: uuid,
  status: z.enum(['Not Started', 'On Track', 'At Risk', 'Blocked', 'Pending Review', 'Completed', 'Dropped']),
  drop_reason: z.string().max(500).optional(),
  blocker: z.object({
    description: z.string().trim().min(5, 'Say what is stopping you'),
    unblocker_id: uuid,
    severity: severityEnum.default('Medium'),
  }).optional(),
});

export const dayCloseSchema = z.object({
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fixed_done_task_ids: z.array(uuid).default([]),
  actual: z.coerce.number().min(0).nullable(),
  reactive_hours: z.coerce.number().min(0).max(24).multipleOf(0.5).default(0),
  reactive_tags: z.array(z.string().max(40)).max(8).default([]),
  blocker: z.object({
    description: z.string().trim().min(5, 'Say what is stopping you').max(1000),
    unblocker_id: uuid,
    severity: severityEnum.default('Medium'),
  }).nullable().default(null),
  top_3_tomorrow: z.array(z.string().trim().max(200)).max(3).default([]),
  assigned_status_changes: z.array(z.object({
    task_id: uuid,
    status: z.enum(['On Track', 'At Risk', 'Completed']),
  })).default([]),
  opened_at: z.string().datetime({ offset: true }).optional(), // five-minute promise metric
});
export type DayCloseInput = z.infer<typeof dayCloseSchema>;

export const addPersonSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(20).optional(),
  department: departmentEnum,
  designation: z.string().trim().min(2).max(120),
  reports_to_id: uuid,
  joined_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  access_role: accessRoleEnum.default('Member'),
  capabilities: z.array(z.enum(['hr_admin', 'finance_admin', 'people_admin'])).default([]),
  daily_capacity_hours: z.coerce.number().min(1).max(16).default(8),
  wip_limit_p1: z.coerce.number().int().min(1).max(10).default(3),
});

export const charterTaskSchema = z.object({
  charter_id: uuid,
  title: z.string().trim().min(3).max(200),
  cadence: cadenceEnum,
  definition_of_done: z.string().trim().min(3).max(500),
  weekday_mask: z.array(z.number().int().min(1).max(7)).optional(),
  month_day: z.number().int().min(1).max(31).optional(),
});

export const kpiSchema = z.object({
  person_id: uuid,
  metric: z.string().trim().min(2).max(120),
  unit: kpiUnitEnum,
  target_type: targetTypeEnum,
  direction: directionEnum,
  daily_target: z.coerce.number().min(0),
  review_cadence: cadenceEnum,
  is_primary: z.boolean().default(false),
});

export const blockerResponseSchema = z.object({
  blocker_id: uuid,
  action: z.enum(['got-it', 'resolve']),
  resolution_note: z.string().max(1000).optional(),
});

export const commentSchema = z.object({
  subject_type: z.enum(['task', 'day_close', 'blocker']),
  subject_id: uuid,
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(uuid).max(10).default([]),
});

export const askSchema = z.object({
  to_person_id: uuid,
  body: z.string().trim().min(5, 'Say what you need').max(2000),
});

export const kudosSchema = z.object({
  to_person_id: uuid,
  note: z.string().trim().min(2).max(500),
  task_id: uuid.optional(),
});

export const handoverSchema = z.object({
  from_person_id: uuid,
  task_moves: z.array(z.object({
    task_id: uuid,
    action: z.enum(['reassign', 'drop']),
    to_person_id: uuid.optional(),
    reason: z.string().max(300).optional(),
  })),
  support_swaps: z.array(z.object({
    participant_id: uuid,
    action: z.enum(['remove', 'swap']),
    to_person_id: uuid.optional(),
  })).default([]),
  duty_moves: z.array(z.object({
    charter_task_id: uuid,
    action: z.enum(['reassign', 'suspend']),
    to_person_id: uuid.optional(),
  })),
  blocker_moves: z.array(z.object({
    blocker_id: uuid,
    to_person_id: uuid,
  })),
  kpi_moves: z.array(z.object({
    kpi_id: uuid,
    action: z.enum(['transfer', 'close']),
    to_person_id: uuid.optional(),
  })),
  approval_moves: z.array(z.object({
    approval_id: uuid,
    to_person_id: uuid,
  })).default([]),
  report_moves: z.array(z.object({
    person_id: uuid,
    new_manager_id: uuid,
  })).default([]),
});
export type HandoverInput = z.infer<typeof handoverSchema>;
