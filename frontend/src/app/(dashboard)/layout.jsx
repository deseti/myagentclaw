'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Bot, MessageSquare, BookOpen, Inbox, Users, CreditCard, LogOut, Wrench, Menu, X, LineChart, Wallet, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { logout, isAuthenticated } from '@/lib/auth';
import api from '@/lib/api';
import {
  canAccessInternalSkill,
  getInstalledInternalSkill,
  getInternalSkillDefinition,
  INTERNAL_SKILL_KEYS,
  isInternalSkillActive,
} from '@/lib/internalSkills';
import { connectSocket } from '@/lib/socket';
import { useDashboardStore } from '@/store/workspace.store';

const POLYMARKET_MINIMUM_TIER = getInternalSkillDefinition(INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY)?.minimumTier || 'GROWTH';
const PAYMENT_REMINDER_MINIMUM_TIER = getInternalSkillDefinition(INTERNAL_SKILL_KEYS.PAYMENT_REMINDER)?.minimumTier || 'STARTER';
const APPOINTMENT_SCHEDULER_MINIMUM_TIER = getInternalSkillDefinition(INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER)?.minimumTier || 'STARTER';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/agents', label: 'Agent', icon: Bot },
  { href: '/dashboard/channels', label: 'Channel', icon: MessageSquare },
  { href: '/dashboard/skills', label: 'Skills', icon: Wrench },
  { href: '/dashboard/polymarket', label: 'Polymarket', icon: LineChart },
  { href: '/dashboard/payment-reminder', label: 'Payment Reminder', icon: Wallet },
  { href: '/dashboard/appointment-scheduler', label: 'Appointment Scheduler', icon: CalendarDays },
  { href: '/dashboard/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { href: '/dashboard/conversations', label: 'Percakapan', icon: Inbox, badge: 'needsAdmin' },
  { href: '/dashboard/customers', label: 'Customer', icon: Users },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
];

function NavItem({ href, label, icon: Icon, badge, needsAdminCount, onNavigate }) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/20 text-primary'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge === 'needsAdmin' && needsAdminCount > 0 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-bold">
          {needsAdminCount > 9 ? '9+' : needsAdminCount}
        </span>
      )}
    </Link>
  );
}

function SidebarContent({ navItems, needsAdmin, onNavigate, onLogout, mobile = false }) {
  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
        <span className="font-bold text-lg tracking-tight text-white">myagentclaw</span>
        {mobile && (
          <button
            type="button"
            onClick={onNavigate}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Tutup menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {navItems.map((item) => (
          <NavItem key={item.href} {...item} needsAdminCount={needsAdmin} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-slate-800 p-2">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const needsAdmin = useDashboardStore((s) => s.needsAdmin);
  const incrementChatToday = useDashboardStore((s) => s.incrementChatToday);
  const incrementNeedsAdmin = useDashboardStore((s) => s.incrementNeedsAdmin);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [hasActivePolymarketSkill, setHasActivePolymarketSkill] = useState(false);
  const [hasActivePaymentReminderSkill, setHasActivePaymentReminderSkill] = useState(false);
  const [hasActiveAppointmentSchedulerSkill, setHasActiveAppointmentSchedulerSkill] = useState(false);

  const handleLogout = () => logout();
  const navItems = NAV_ITEMS.filter((item) => {
    if (workspaceTier === 'FREE' && (
      item.href === '/dashboard/skills'
      || item.href === '/dashboard/polymarket'
      || item.href === '/dashboard/payment-reminder'
      || item.href === '/dashboard/appointment-scheduler'
    )) {
      return false;
    }

    if (item.href === '/dashboard/polymarket' && !hasActivePolymarketSkill) {
      return false;
    }

    if (item.href === '/dashboard/payment-reminder' && !hasActivePaymentReminderSkill) {
      return false;
    }

    if (item.href === '/dashboard/appointment-scheduler' && !hasActiveAppointmentSchedulerSkill) {
      return false;
    }

    return true;
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    const socket = connectSocket();
    if (!socket) return;

    const onNewMessage = () => incrementChatToday();
    const onHandoff = () => {
      incrementNeedsAdmin();
      // Browser notification
      if (Notification.permission === 'granted') {
        new Notification('myagentclaw — Perlu Admin', {
          body: 'Ada percakapan yang butuh perhatian admin',
        });
      }
    };

    socket.on('chat:new_message', onNewMessage);
    socket.on('chat:handoff_needed', onHandoff);

    return () => {
      socket.off('chat:new_message', onNewMessage);
      socket.off('chat:handoff_needed', onHandoff);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated()) return undefined;

    api.get('/auth/me')
      .then(async ({ data }) => {
        if (!cancelled) {
          const nextTier = data.workspace?.subTier || 'FREE';
          const polymarketEligible = canAccessInternalSkill(nextTier, POLYMARKET_MINIMUM_TIER);
          const paymentReminderEligible = canAccessInternalSkill(nextTier, PAYMENT_REMINDER_MINIMUM_TIER);
          const appointmentSchedulerEligible = canAccessInternalSkill(nextTier, APPOINTMENT_SCHEDULER_MINIMUM_TIER);
          setWorkspaceTier(nextTier);

          if (nextTier === 'FREE') {
            setHasActivePolymarketSkill(false);
            setHasActivePaymentReminderSkill(false);
            setHasActiveAppointmentSchedulerSkill(false);
            if (pathname.startsWith('/dashboard/payment-reminder')) {
              router.replace('/dashboard/skills');
            }
            if (pathname.startsWith('/dashboard/appointment-scheduler')) {
              router.replace('/dashboard/skills');
            }
            return;
          }

          if (!polymarketEligible) {
            setHasActivePolymarketSkill(false);
            if (pathname.startsWith('/dashboard/polymarket')) {
              router.replace('/dashboard/skills');
            }
          }

          if (!paymentReminderEligible) {
            setHasActivePaymentReminderSkill(false);
            if (pathname.startsWith('/dashboard/payment-reminder')) {
              router.replace('/dashboard/skills');
            }
          }

          if (!appointmentSchedulerEligible) {
            setHasActiveAppointmentSchedulerSkill(false);
            if (pathname.startsWith('/dashboard/appointment-scheduler')) {
              router.replace('/dashboard/skills');
            }
          }

          try {
            const { data: skillsData } = await api.get('/skills/installed');
            if (cancelled) return;

            const installedSkills = Array.isArray(skillsData.skills) ? skillsData.skills : [];
            const polymarketSkill = getInstalledInternalSkill(installedSkills, INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY);
            const paymentReminderSkill = getInstalledInternalSkill(installedSkills, INTERNAL_SKILL_KEYS.PAYMENT_REMINDER);
            const appointmentSchedulerSkill = getInstalledInternalSkill(installedSkills, INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER);
            const polymarketActive = isInternalSkillActive(polymarketSkill);
            const paymentReminderActive = paymentReminderEligible && isInternalSkillActive(paymentReminderSkill);
            const appointmentSchedulerActive = appointmentSchedulerEligible && isInternalSkillActive(appointmentSchedulerSkill);
            setHasActivePolymarketSkill(polymarketActive);
            setHasActivePaymentReminderSkill(paymentReminderActive);
            setHasActiveAppointmentSchedulerSkill(appointmentSchedulerActive);

            if (!polymarketActive && pathname.startsWith('/dashboard/polymarket')) {
              router.replace('/dashboard/skills');
            }

            if (!paymentReminderActive && pathname.startsWith('/dashboard/payment-reminder')) {
              router.replace('/dashboard/skills');
            }

            if (!appointmentSchedulerActive && pathname.startsWith('/dashboard/appointment-scheduler')) {
              router.replace('/dashboard/skills');
            }
          } catch {
            if (!cancelled) {
              setHasActivePolymarketSkill(false);
              setHasActivePaymentReminderSkill(false);
              setHasActiveAppointmentSchedulerSkill(false);
              if (pathname.startsWith('/dashboard/polymarket')) {
                router.replace('/dashboard/skills');
              }
              if (pathname.startsWith('/dashboard/payment-reminder')) {
                router.replace('/dashboard/skills');
              }
              if (pathname.startsWith('/dashboard/appointment-scheduler')) {
                router.replace('/dashboard/skills');
              }
            }
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceTier('FREE');
          setHasActivePolymarketSkill(false);
          setHasActivePaymentReminderSkill(false);
          setHasActiveAppointmentSchedulerSkill(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <aside className="hidden h-screen w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 lg:flex">
        <SidebarContent navItems={navItems} needsAdmin={needsAdmin} onNavigate={() => {}} onLogout={handleLogout} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold tracking-tight">myagentclaw</span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              Logout
            </button>
          </div>
        </header>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />
        )}

        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[320px] flex-col border-r border-slate-800 bg-slate-900 shadow-2xl transition-transform duration-200 ease-out lg:hidden',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <SidebarContent navItems={navItems} needsAdmin={needsAdmin} onNavigate={() => setMobileNavOpen(false)} onLogout={handleLogout} mobile />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto h-full w-full p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
