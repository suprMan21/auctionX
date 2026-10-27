/**
 * Admin console UX-3 — Settings: Pricing, Free transfers and the delete
 * waiting time, all on one page so each task is Settings → button → confirm
 * (3 clicks; tabs would add one). Each section shows only to staff who may
 * open it (display only; the API enforces every permission). `?tab=` scrolls
 * to a section, so a link can land on the right one.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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

export const AdminSettingsPage = () => {
  const access = useAdminRole();
  const [searchParams] = useSearchParams();
  const tabs = SETTINGS_TABS.filter((t) => hasPermission(access, t.permission));
  const requested = searchParams.get('tab');
  const ready = access.status === 'known' && tabs.length > 0;

  useEffect(() => {
    if (!ready || !requested) return;
    document.getElementById(`settings-${requested}`)?.scrollIntoView?.({ block: 'start' });
  }, [ready, requested]);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Prices, free transfers and how long a retired account waits before it can be deleted.</p>
      </div>

      {tabs.length > 1 && (
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <a
              key={t.value}
              href={`#settings-${t.value}`}
              className={cn(
                'min-h-[44px] inline-flex items-center px-4 rounded-xl text-sm font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                t.value === requested ? 'bg-primary-500/20 text-primary-300' : 'text-gray-300 hover:text-white hover:bg-white/5',
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}

      {tabs.map((t) => (
        <section key={t.value} id={`settings-${t.value}`} aria-label={t.label} className="scroll-mt-6">
          {t.value === 'pricing' && <AdminPricingPage embedded />}
          {t.value === 'free-transfers' && <AdminVouchersPage embedded />}
          {t.value === 'account-deletion' && <DeleteWindowCard canEdit={hasPermission(access, PERMISSIONS.manageAdmins)} />}
        </section>
      ))}
    </div>
  );
};
