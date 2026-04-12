'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CircleHelp,
  Cpu,
  Download,
  Loader2,
  Lock,
  PanelLeft,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import {
  buildInternalSkillSearchText,
  formatSkillRequirementLabel,
  getInternalSkillState,
  INTERNAL_SKILL_DEFINITIONS,
} from '@/lib/internalSkills';
import { cn } from '@/lib/utils';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'installed', label: 'Installed' },
  { key: 'available', label: 'Available' },
  { key: 'locked', label: 'Locked' },
  { key: 'coming-soon', label: 'Coming Soon' },
];

const STATUS_META = {
  active: {
    label: 'Active',
    badgeVariant: 'success',
    toneClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  },
  installed: {
    label: 'Installed',
    badgeVariant: 'default',
    toneClass: 'border-sky-500/30 bg-sky-500/10 text-sky-100',
  },
  available: {
    label: 'Available',
    badgeVariant: 'outline',
    toneClass: 'border-slate-700 bg-slate-900/80 text-slate-200',
  },
  locked: {
    label: 'Locked',
    badgeVariant: 'warning',
    toneClass: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
  'coming-soon': {
    label: 'Coming Soon',
    badgeVariant: 'warning',
    toneClass: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  },
};

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.available;
}

function getSkillStatusKey(skill) {
  if (skill?.isComingSoon) return 'coming-soon';
  return skill?.status || 'available';
}

function getSkillGuidance(skill) {
  if (skill.isComingSoon) {
    if (skill.isLocked) {
      return `${formatSkillRequirementLabel(skill.minimumTier)}. Skill ini masih Coming Soon dan belum bisa diinstall, jadi sidebar, worker, dan role terkait tetap nonaktif.`;
    }

    return `Workspace Anda sudah memenuhi ${formatSkillRequirementLabel(skill.minimumTier)}, tetapi skill ini masih Coming Soon dan belum tersedia untuk diinstall.`;
  }

  if (skill.status === 'locked') {
    return `${formatSkillRequirementLabel(skill.minimumTier)}. Upgrade tier dulu, lalu install manual dari runtime internal.`;
  }

  if (skill.status === 'available') {
    return 'Skill sudah eligible. Install manual dulu, lalu assign ke minimal satu agent agar status berubah menjadi Active.';
  }

  if (skill.status === 'installed') {
    return 'Skill sudah terinstall, tetapi sidebar, worker, dan role terkait masih nonaktif sampai dipakai agent.';
  }

  return `Skill aktif karena sudah dipakai ${skill.assignedCount} agent di workspace ini.`;
}

function getPrimaryActionLabel(skill) {
  if (skill.isComingSoon) return 'Coming Soon';
  if (skill.status === 'locked') return 'Upgrade to Unlock';
  if (skill.status === 'available') return 'Install Skill';
  if (skill.status === 'installed') return 'Assign to Agent';
  return skill.opensSidebar ? 'Open Dashboard' : 'Open Skill';
}

function SkillSignal({ icon: Icon, label, value, helpText }) {
  return (
    <div
      title={helpText}
      className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1.5 text-[11px] text-slate-300"
    >
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
      <CircleHelp className="h-3 w-3 text-slate-500" />
    </div>
  );
}

function SkillPrimaryAction({ skill, installingKey, onInstall, size = 'sm' }) {
  if (skill.isComingSoon) {
    return (
      <Button size={size} variant="outline" disabled>
        {getPrimaryActionLabel(skill)}
      </Button>
    );
  }

  if (skill.status === 'locked') {
    return (
      <Button asChild size={size} variant="outline">
        <Link href="/dashboard/billing">{getPrimaryActionLabel(skill)}</Link>
      </Button>
    );
  }

  if (skill.status === 'available') {
    return (
      <Button size={size} onClick={() => onInstall(skill.slug)} disabled={installingKey === skill.key}>
        {installingKey === skill.key ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {getPrimaryActionLabel(skill)}
      </Button>
    );
  }

  if (skill.status === 'installed') {
    return (
      <Button asChild size={size}>
        <Link href="/dashboard/agents">{getPrimaryActionLabel(skill)}</Link>
      </Button>
    );
  }

  return (
    <Button asChild size={size}>
      <Link href={skill.dashboardHref || '/dashboard/agents'}>{getPrimaryActionLabel(skill)}</Link>
    </Button>
  );
}

function SkillCard({ skill, selected, installingKey, onInstall, onSelect }) {
  const statusMeta = getStatusMeta(getSkillStatusKey(skill));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(skill.key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(skill.key);
        }
      }}
      className={cn(
        'group rounded-3xl border p-5 text-left transition outline-none',
        selected
          ? 'border-sky-400/40 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]'
          : 'border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-900',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{skill.displayName}</p>
            <Badge variant={statusMeta.badgeVariant}>{statusMeta.label}</Badge>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-slate-500">
            {skill.category} . {skill.key}
          </p>
        </div>

        <div className={cn('rounded-full border px-3 py-1 text-[11px] font-medium', statusMeta.toneClass)}>
          {formatSkillRequirementLabel(skill.minimumTier)}
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-300">{skill.shortDescription}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <SkillSignal
          icon={Users}
          label="Agents"
          value={skill.isComingSoon ? 'Not available' : skill.isActive ? `${skill.assignedCount} active` : skill.isInstalled ? 'Installed only' : '0 active'}
          helpText="Status Active berarti skill sudah dipakai minimal satu agent di workspace ini."
        />
        <SkillSignal
          icon={PanelLeft}
          label="Sidebar"
          value={skill.isComingSoon ? 'Not available' : skill.opensSidebar ? (skill.isActive ? 'Visible' : 'Hidden until active') : 'No menu'}
          helpText="Sidebar atau menu workspace hanya muncul setelah skill ini benar-benar aktif."
        />
        <SkillSignal
          icon={Cpu}
          label="Worker"
          value={skill.isComingSoon ? 'Not available' : skill.enablesWorker ? (skill.isActive ? 'Running' : 'Idle until active') : 'No worker'}
          helpText="Worker background hanya berjalan saat skill ini aktif."
        />
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="max-w-xl text-xs leading-5 text-slate-500">{getSkillGuidance(skill)}</p>
        <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
          <SkillPrimaryAction skill={skill} installingKey={installingKey} onInstall={onInstall} />
        </div>
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [installedSkills, setInstalledSkills] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedSkillKey, setSelectedSkillKey] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [installingKey, setInstallingKey] = useState('');
  const [uninstallingKey, setUninstallingKey] = useState('');
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [error, setError] = useState('');

  async function loadInstalled() {
    const { data } = await api.get('/skills/installed');
    setInstalledSkills(Array.isArray(data.skills) ? data.skills : []);
  }

  async function refreshSkills(options = {}) {
    const { silent = false } = options;

    if (!silent) {
      setRefreshing(true);
    }

    try {
      await loadInstalled();
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat daftar internal skill');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleInstall(slug) {
    setInstallingKey(slug);
    setError('');

    try {
      await api.post('/skills/install-bundled', { slug });
      await refreshSkills({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menginstall internal skill');
    } finally {
      setInstallingKey('');
    }
  }

  async function handleUninstall(skill) {
    const slug = String(skill?.slug || skill?.installedSkill?.slug || skill?.key || '').trim();
    if (!slug) return;

    const assignedCount = Number(skill?.assignedCount || 0);
    const confirmationMessage = assignedCount > 0
      ? `Skill ini sedang aktif di ${assignedCount} agent. Uninstall akan melepas assignment tersebut. Lanjutkan?`
      : 'Uninstall skill ini dari runtime workspace?';

    if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
      return;
    }

    setUninstallingKey(skill.key);
    setError('');

    try {
      await api.delete(`/skills/${slug}`);
      await refreshSkills({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus internal skill');
    } finally {
      setUninstallingKey('');
    }
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        const { data: me } = await api.get('/auth/me');
        const currentTier = me.workspace?.subTier || 'FREE';
        setWorkspaceTier(currentTier);

        if (currentTier !== 'FREE') {
          await loadInstalled();
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Gagal memuat halaman internal skills');
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
  }, []);

  function matchesFilter(skill, filterKey) {
    if (filterKey === 'all') return true;
    if (filterKey === 'coming-soon') return skill.isComingSoon;
    if (skill.isComingSoon) return false;
    return skill.status === filterKey;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const allSkills = INTERNAL_SKILL_DEFINITIONS
    .map((skill) => getInternalSkillState(skill.key, installedSkills, workspaceTier))
    .filter(Boolean)
    .filter((skill) => !skill.isHidden);

  const filteredSkills = allSkills.filter((skill) => {
    if (!matchesFilter(skill, statusFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return buildInternalSkillSearchText(skill).includes(normalizedQuery);
  });

  const selectedSkillVisible = filteredSkills.some((skill) => skill.key === selectedSkillKey);
  const firstFilteredSkillKey = filteredSkills[0]?.key || '';

  useEffect(() => {
    if (!filteredSkills.length) {
      if (selectedSkillKey) {
        setSelectedSkillKey('');
      }
      return;
    }

    if (!selectedSkillVisible) {
      setSelectedSkillKey(firstFilteredSkillKey);
    }
  }, [filteredSkills.length, firstFilteredSkillKey, selectedSkillKey, selectedSkillVisible]);

  const selectedSkill = filteredSkills.find((skill) => skill.key === selectedSkillKey) || filteredSkills[0] || null;
  const dependencySkill = selectedSkill?.dependsOn
    ? getInternalSkillState(selectedSkill.dependsOn, installedSkills, workspaceTier)
    : null;

  const installedAndActiveSkills = filteredSkills.filter(
    (skill) => !skill.isComingSoon && (skill.status === 'active' || skill.status === 'installed'),
  );
  const readySkills = filteredSkills.filter(
    (skill) => !skill.isComingSoon && (skill.status === 'available' || skill.status === 'locked'),
  );
  const comingSoonSkills = filteredSkills.filter((skill) => skill.isComingSoon);

  const stats = [
    {
      label: 'Built-in Skills',
      value: String(allSkills.length),
      toneClass: 'from-sky-500/15 to-transparent',
    },
    {
      label: 'Ready Now',
      value: String(allSkills.filter((skill) => !skill.isComingSoon && !skill.isLocked).length),
      toneClass: 'from-emerald-500/15 to-transparent',
    },
    {
      label: 'Installed',
      value: String(allSkills.filter((skill) => !skill.isComingSoon && skill.isInstalled).length),
      toneClass: 'from-cyan-500/15 to-transparent',
    },
    {
      label: 'Active',
      value: String(allSkills.filter((skill) => !skill.isComingSoon && skill.isActive).length),
      toneClass: 'from-amber-500/15 to-transparent',
    },
    {
      label: 'Coming Soon',
      value: String(allSkills.filter((skill) => skill.isComingSoon).length),
      toneClass: 'from-yellow-500/15 to-transparent',
    },
  ];

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_28%)]" />
        <div className="relative space-y-6 p-6 md:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-100">
                <Sparkles className="h-3.5 w-3.5" />
                Internal modular skill system
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white md:text-3xl">Internal Skills</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  Semua capability di halaman ini berasal dari registry internal MyAgentClaw. Install tetap manual per workspace, dan status Active hanya tercapai setelah skill dipakai minimal satu agent.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => refreshSkills()} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button asChild>
                <Link href="/dashboard/agents">
                  Manage Agents
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className={cn(
                  'rounded-2xl border border-slate-800 bg-gradient-to-br p-4',
                  stat.toneClass,
                )}
              >
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{stat.label}</p>
                <p className="mt-3 text-2xl font-semibold text-white">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari skill internal, capability, atau slug"
                className="border-slate-700 bg-slate-900/90 pl-9 text-slate-100 placeholder:text-slate-500"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => {
                const count = filter.key === 'all'
                  ? allSkills.length
                  : allSkills.filter((skill) => matchesFilter(skill, filter.key)).length;

                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setStatusFilter(filter.key)}
                    className={cn(
                      'rounded-full border px-3 py-2 text-xs font-medium transition',
                      statusFilter === filter.key
                        ? 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                        : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white',
                    )}
                  >
                    {filter.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {workspaceTier === 'FREE' && (
        <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-50">
          <Lock className="h-4 w-4" />
          <AlertDescription>
            Workspace FREE hanya bisa melihat katalog internal skill. Upgrade ke <Link href="/dashboard/billing" className="underline underline-offset-4">Starter atau Growth</Link>, lalu install skill secara manual saat tier sudah memenuhi syarat.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_380px]">
        <div className="space-y-6">
          <Card className="border-slate-800 bg-slate-950/70">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Installed & Active Skills</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Status Active berarti skill sudah dipakai agent, sehingga menu, role, dan worker terkait boleh hidup.
                  </p>
                </div>
                <Badge variant="outline">{installedAndActiveSkills.length}</Badge>
              </div>

              {installedAndActiveSkills.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/80 p-6 text-sm text-slate-400">
                  {normalizedQuery
                    ? 'Tidak ada internal skill terinstall yang cocok dengan filter saat ini.'
                    : 'Belum ada internal skill yang terinstall di runtime workspace ini.'}
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {installedAndActiveSkills.map((skill) => (
                    <SkillCard
                      key={skill.key}
                      skill={skill}
                      selected={selectedSkillKey === skill.key}
                      installingKey={installingKey}
                      onInstall={handleInstall}
                      onSelect={setSelectedSkillKey}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-950/70">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Ready to Install</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Skill built-in yang sudah shipped, baik yang siap diinstall maupun yang masih menunggu tier workspace memenuhi syarat.
                  </p>
                </div>
                <Badge variant="outline">{readySkills.length}</Badge>
              </div>

              {readySkills.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/80 p-6 text-sm text-slate-400">
                  {normalizedQuery
                    ? 'Tidak ada internal skill shipped yang cocok dengan pencarian ini.'
                    : 'Semua internal skill shipped yang relevan dengan filter ini sudah terpasang atau aktif.'}
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {readySkills.map((skill) => (
                    <SkillCard
                      key={skill.key}
                      skill={skill}
                      selected={selectedSkillKey === skill.key}
                      installingKey={installingKey}
                      onInstall={handleInstall}
                      onSelect={setSelectedSkillKey}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-950/70">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Coming Soon</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Placeholder internal skill yang sudah masuk roadmap katalog, tetapi belum tersedia untuk install atau aktivasi.
                  </p>
                </div>
                <Badge variant="warning">{comingSoonSkills.length}</Badge>
              </div>

              {comingSoonSkills.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/80 p-6 text-sm text-slate-400">
                  {normalizedQuery
                    ? 'Tidak ada placeholder skill Coming Soon yang cocok dengan pencarian ini.'
                    : 'Belum ada placeholder skill tambahan di roadmap saat ini.'}
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {comingSoonSkills.map((skill) => (
                    <SkillCard
                      key={skill.key}
                      skill={skill}
                      selected={selectedSkillKey === skill.key}
                      installingKey={installingKey}
                      onInstall={handleInstall}
                      onSelect={setSelectedSkillKey}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit border-slate-800 bg-slate-950/80 xl:sticky xl:top-6">
          <CardContent className="space-y-6 p-6">
            {!selectedSkill ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950/80 p-8 text-center text-sm text-slate-400">
                Tidak ada skill yang cocok dengan filter saat ini.
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-semibold text-white">{selectedSkill.displayName}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-slate-500">{selectedSkill.key}</p>
                    </div>
                    <Badge variant={getStatusMeta(getSkillStatusKey(selectedSkill)).badgeVariant}>{getStatusMeta(getSkillStatusKey(selectedSkill)).label}</Badge>
                  </div>

                  <p className="text-sm leading-6 text-slate-300">{selectedSkill.fullDescription}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Minimum Tier</p>
                    <p className="mt-2 text-sm font-medium text-white">{formatSkillRequirementLabel(selectedSkill.minimumTier)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Installed Version</p>
                    <p className="mt-2 text-sm font-medium text-white">{selectedSkill.isComingSoon ? 'Coming Soon' : selectedSkill.version || 'Belum terinstall'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Agents Using Skill</p>
                    <p className="mt-2 text-sm font-medium text-white">{selectedSkill.assignedCount}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Install Mode</p>
                    <p className="mt-2 text-sm font-medium text-white">{selectedSkill.isComingSoon ? 'Not available yet' : 'Manual built-in install'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Opens Sidebar</p>
                    <p className="mt-2 text-sm font-medium text-white">
                      {selectedSkill.opensSidebar ? (selectedSkill.opensSidebarLabel || selectedSkill.displayName) : 'No sidebar menu'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Worker</p>
                    <p className="mt-2 text-sm font-medium text-white">
                      {selectedSkill.enablesWorker ? (selectedSkill.workerName || 'Enabled') : 'No worker'}
                    </p>
                  </div>
                </div>

                {dependencySkill && (
                  <Alert className="border-slate-800 bg-slate-950/90 text-slate-200">
                    <AlertDescription>
                      Dependensi utama: <strong>{dependencySkill.displayName}</strong>. Status saat ini: <strong>{getStatusMeta(dependencySkill.status).label}</strong>.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{selectedSkill.isComingSoon ? 'Planned Capability' : 'What This Skill Unlocks'}</p>
                  <div className="space-y-2">
                    {selectedSkill.unlocks.map((item) => (
                      <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-300">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                {selectedSkill.roleUnlocks.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Role Unlocks</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedSkill.roleUnlocks.map((roleName) => (
                        <Badge key={roleName} variant="outline">{roleName}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {selectedSkill.assignedAgents.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Assigned Agents</p>
                    <div className="space-y-2">
                      {selectedSkill.assignedAgents.map((agent) => (
                        <div key={agent.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-300">
                          <span>{agent.name}</span>
                          <Bot className="h-4 w-4 text-slate-500" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Alert className="border-slate-800 bg-slate-950/90 text-slate-200">
                  <AlertDescription>{getSkillGuidance(selectedSkill)}</AlertDescription>
                </Alert>

                <div className="flex flex-col gap-3">
                  <SkillPrimaryAction skill={selectedSkill} installingKey={installingKey} onInstall={handleInstall} size="default" />

                  {selectedSkill.isInstalled && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => handleUninstall(selectedSkill)}
                      disabled={uninstallingKey === selectedSkill.key}
                    >
                      {uninstallingKey === selectedSkill.key ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Uninstall Skill
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}