/**
 * Admin console UX-3 — Settings: Pricing, Free transfers and the delete
 * waiting time on one page. Each tab shows only to staff who may open it
 * (display only; the API enforces every permission). The tab is in the URL
 * (?tab=), so a link can open the right one.
 */

import { Link, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { AdminPricingPage } from './AdminPricingPage';
import { AdminVouchersPage } from './AdminVouchersPage';
import { DeleteWindowCard } from '../components/DeleteWindowCard';

export const SETTINGS_TABS = [
  { value: 'pricing', label: 'Pricing', permission: PERMISSIONS.managePricing },
  { value: 'free-transfers', label: 'Free transfers', permission: PERMISSIONS.managePricing },
  { value: 'account-deletion', label: 'Account deletion', permission: PERMISSIONS.viewUsers },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['value'];

export const AdminSettingsPage = () => {
  const access = useAdminRole();
  const [searchParams] = useSearchParams();
  const tabs = SETTINGS_TABS.filter((t) => hasPermission(access, t.permission));

  if (access.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Checking your access">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (tabs.length === 0) {
    return (
      <div className="glass rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-white mb-2">Not available for your staff role</h1>
        <p className="text-gray-400 text-sm">Your staff role does not include this page. Ask a super admin if you need access.</p>
      </div>
    );
  }

  const requested = searchParams.get('tab');
  // An unknown or not-allowed tab falls back to the first one this person may open.
  const tab: SettingsTab = tabs.find((t) => t.value === requested)?.value ?? tabs[0].value;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Prices, free transfers and how long a retired account waits before it can be deleted.</p>
      </div>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.value}
            to={`/admin/settings?tab=${t.value}`}
            aria-current={t.value === tab ? 'page' : undefined}
            className={cn(
              'min-h-[44px] inline-flex items-center px-4 rounded-xl text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              t.value === tab ? 'bg-primary-500/20 text-primary-300' : 'text-gray-300 hover:text-white hover:bg-white/5',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'pricing' && <AdminPricingPage embedded />}
      {tab === 'free-transfers' && <AdminVouchersPage embedded />}
      {tab === 'account-deletion' && <DeleteWindowCard canEdit={hasPermission(access, PERMISSIONS.manageAdmins)} />}
    </div>
  );
};
