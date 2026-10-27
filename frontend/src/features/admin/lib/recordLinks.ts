/**
 * UX-3: where an audit row's target lives in the console. Returns null when
 * there is no page for it, or the viewer may not open that page (the link
 * would only lead to "You do not have access").
 */

import { hasPermission, PERMISSIONS, type AdminAccessState } from './adminRole';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Target {
  entity_type: string | null | undefined;
  entity_id: string | null | undefined;
}

export const recordLinkFor = (log: Target, access: AdminAccessState): string | null => {
  const type = (log.entity_type ?? '').toLowerCase();
  const id = log.entity_id ?? '';
  const can = (p: string) => hasPermission(access, p);
  const enc = encodeURIComponent(id);

  switch (type) {
    case 'user':
    case 'users':
    case 'admin_user':
      return UUID.test(id) && can(PERMISSIONS.viewUsers) ? `/admin/users/${enc}` : null;
    case 'tag':
    case 'nfc_tag':
      return UUID.test(id) && can(PERMISSIONS.manageNfc) ? `/admin/tags/${enc}` : null;
    case 'reissue_request':
      return UUID.test(id) && can(PERMISSIONS.manageNfc) ? `/admin/reissue-requests?request=${enc}` : null;
    case 'payment_incident':
      // The stuck-payments page has no per-payment view yet: open the list.
      return can(PERMISSIONS.reapplyPayments) ? '/admin/stuck-payments' : null;
    case 'token_price':
      return can(PERMISSIONS.managePricing) ? '/admin/settings?tab=pricing' : null;
    case 'transfer_voucher_grant':
      return can(PERMISSIONS.managePricing) ? '/admin/settings?tab=free-transfers' : null;
    case 'account_settings':
      return can(PERMISSIONS.viewUsers) ? '/admin/settings?tab=account-deletion' : null;
    default:
      // Searches are keyed on the staff member who searched, not a record.
      return null;
  }
};
