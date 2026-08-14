import 'server-only';
import { Resend } from 'resend';
import { supabaseAdmin } from './supabase/admin';
import { minutesOfDayLocal } from './dates';
import { PRODUCT_NAME } from './constants';

/**
 * The §12 notification matrix. In-app always; email only where the matrix
 * says so. Quiet hours 21:00–08:00 hold back everything except P1 blocker
 * escalations. Every kind is individually mutable per person, except
 * blockers assigned to them.
 */
export type NotificationKind =
  | 'task_assigned'            // email
  | 'peer_request_received'    // email
  | 'request_accepted'         // in-app
  | 'request_declined'         // in-app
  | 'request_countered'        // in-app
  | 'added_as_support'         // email
  | 'support_removed'          // in-app
  | 'task_due_tomorrow'        // in-app
  | 'task_overdue'             // email, once
  | 'blocker_raised_on_you'    // email, immediate — never mutable
  | 'blocker_escalated'        // email to manager — never mutable
  | 'blocker_resolved'         // in-app
  | 'approval_requested'       // email
  | 'approval_decided'         // in-app
  | 'close_reviewed'           // in-app
  | 'close_edited_after_review'// in-app (manager re-notify)
  | 'kudos'                    // in-app
  | 'handover_affecting_you'   // email
  | 'ask_received'             // in-app
  | 'announcement'             // in-app
  | 'unanswered_peer_request'; // in-app (manager surface)

const EMAIL_KINDS = new Set<NotificationKind>([
  'task_assigned', 'peer_request_received', 'added_as_support', 'task_overdue',
  'blocker_raised_on_you', 'blocker_escalated', 'approval_requested',
  'handover_affecting_you',
]);

const NEVER_MUTABLE = new Set<NotificationKind>([
  'blocker_raised_on_you', 'blocker_escalated',
]);

const QUIET_START = 21 * 60; // 21:00
const QUIET_END = 8 * 60;    // 08:00

function inQuietHours(now = new Date()): boolean {
  const m = minutesOfDayLocal(now);
  return m >= QUIET_START || m < QUIET_END;
}

export interface NotifyArgs {
  personId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  emailSubject?: string;
  emailBody?: string; // plain text; template wraps it
  isP1Escalation?: boolean;
}

/** Insert the in-app row and send email per the matrix. Failures to send mail
 *  never fail the calling action — the in-app row is the record. */
export async function notify(args: NotifyArgs): Promise<void> {
  const admin = supabaseAdmin();

  const { data: person } = await admin
    .from('people')
    .select('id, email, full_name, notification_prefs, status')
    .eq('id', args.personId)
    .single();
  if (!person || person.status === 'Deactivated') return;

  const prefs = (person.notification_prefs ?? {}) as Record<string, boolean>;
  const muted = !NEVER_MUTABLE.has(args.kind) && prefs[args.kind] === false;
  if (muted) return;

  await admin.from('notifications').insert({
    person_id: args.personId,
    kind: args.kind,
    payload: args.payload,
    channel: EMAIL_KINDS.has(args.kind) ? 'email' : 'in-app',
  });

  if (!EMAIL_KINDS.has(args.kind)) return;
  if (inQuietHours() && !args.isP1Escalation) return; // quiet hours

  await sendMail({
    to: person.email,
    subject: args.emailSubject ?? `${PRODUCT_NAME}: ${args.kind.replace(/_/g, ' ')}`,
    text: args.emailBody ?? '',
  }).catch((err) => {
    // Never log a token or an email body (§18) — kind + person id only.
    console.error(`mail send failed kind=${args.kind} person=${args.personId}`, err?.name);
  });
}

export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // mail unconfigured (local dev): in-app rows still flow
  const resend = new Resend(key);
  await resend.emails.send({
    from: process.env.MAIL_FROM ?? `${PRODUCT_NAME} <onboarding@resend.dev>`,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

export async function notifyMany(list: NotifyArgs[]): Promise<void> {
  for (const n of list) await notify(n);
}
