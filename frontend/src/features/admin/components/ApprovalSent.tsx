/**
 * S-2FA Ph3a: what a suspend / reset / retire / re-issue / lift-hold dialog shows
 * when the server answered 202. Nothing has happened yet; another admin approves it first.
 */

import { Link } from 'react-router-dom';
import { approvalLink, type ApprovalPending } from '../api/approvalSchemas';
import { APPROVAL_COPY } from '../lib/labels';
import { formatWhen } from '../lib/display';
import { ADMIN_BUTTON_CLASS } from './AdminDialog';

export const ApprovalSentPanel = ({ approval, onClose }: { approval: ApprovalPending; onClose: () => void }) => (
  <div className="space-y-4">
    <div role="status" className="rounded-xl border border-primary-500/30 bg-primary-500/10 px-4 py-3 text-sm text-gray-200 space-y-1">
      <p className="font-semibold text-white">{APPROVAL_COPY.sentTitle}.</p>
      <p>{APPROVAL_COPY.sent}</p>
      <p className="text-gray-300">Expires {formatWhen(approval.expiresAt)}.</p>
    </div>
    <div className="flex flex-wrap justify-end gap-3">
      <Link
        to={approvalLink(approval.approvalId)}
        className={`${ADMIN_BUTTON_CLASS} inline-flex items-center bg-dark-700 text-primary-300 hover:bg-dark-600`}
      >
        {APPROVAL_COPY.openRequest}
      </Link>
      <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}>
        Done
      </button>
    </div>
  </div>
);

/** Helper line shown above the buttons when the action will wait for a second admin. */
export const ApprovalHelper = () => (
  <p className="text-sm text-amber-200">{APPROVAL_COPY.helper}</p>
);

/** Lifting a hold: waits for a second admin only when someone else set it (the server decides). */
export const HoldHelper = () => (
  <p className="text-sm text-amber-200">{APPROVAL_COPY.holdHelper}</p>
);
