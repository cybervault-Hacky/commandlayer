import {
  IconAlertTriangle,
  IconCheckCircle,
  IconCircle,
  IconShieldCheck,
  IconSpinner,
  IconX,
} from './icons';

/** Display status shared by plan progress and workflow progress. */
export type StepStatus =
  | 'success'
  | 'failed'
  | 'blocked'
  | 'stale'
  | 'cancelled'
  | 'skipped'
  | 'running'
  | 'pending';

export function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'success':
      return <IconCheckCircle size={14} className="cl-step-success" />;
    case 'failed':
      return <IconAlertTriangle size={14} className="cl-step-failed" />;
    case 'blocked':
      return <IconShieldCheck size={14} className="cl-step-blocked" />;
    case 'stale':
      return <IconAlertTriangle size={14} className="cl-step-stale" />;
    case 'cancelled':
    case 'skipped':
      return <IconX size={14} className="cl-step-cancelled" />;
    case 'running':
      return <IconSpinner size={14} className="cl-step-running" />;
    default:
      return <IconCircle size={14} className="cl-step-pending" />;
  }
}
