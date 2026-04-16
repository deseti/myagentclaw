'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, CircleHelp, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { INTERNAL_SKILL_KEYS } from '@/lib/internalSkills';
import {
  MAIN_ROLE_PRESETS_MAP,
  TONE_PRESETS,
  findMatchingInstalledSkill,
  getAvailableAdvancedRolePresets,
  getRolePresetByKey,
  getRolePresetByRoleName,
} from '@/lib/rolePresets';

const DEFAULT_ROLE_KEY = 'customer-service';
const DEFAULT_ROLE_PRESET = getRolePresetByKey(DEFAULT_ROLE_KEY);

const SHARED_WORKSPACE_OPTIONS = [
  {
    value: 'none',
    label: 'Tidak ikut shared workspace',
    description: 'Agent hanya memakai private workspace miliknya sendiri.',
  },
  {
    value: 'ro',
    label: 'Read-only',
    description: 'Agent bisa membaca file bersama, tetapi tidak bisa mengubahnya.',
  },
  {
    value: 'rw',
    label: 'Read-write',
    description: 'Agent bisa membaca dan menulis file bersama antar agent berbayar.',
  },
];

const ACCESS_MODE_OPTIONS = [
  {
    value: 'OPEN_ACCESS',
    label: 'Open Access',
    description: 'Customer baru langsung masuk ke percakapan aktif dan AI merespons seperti biasa.',
    recommendation: 'Recommended for sales and customer service.',
  },
  {
    value: 'APPROVAL_REQUIRED',
    label: 'Approval Required',
    description: 'Customer baru masuk ke status pending sampai mengirim approval code atau diapprove admin.',
    recommendation: 'Recommended for private or internal agents.',
  },
];

const APPOINTMENT_SCHEDULER_DEFAULT_CONFIG = {
  enableBooking: true,
  enableReschedule: true,
  enableCancellation: true,
  enableReminder: true,
  enableAutoSuggestSlot: true,
  defaultMeetingDuration: 60,
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  workingDays: [1, 2, 3, 4, 5],
  timezone: 'Asia/Jakarta',
};

const CRM_PIPELINE_DEFAULT_CONFIG = {
  canManagePipeline: true,
  canMoveStage: true,
  canAssignLead: true,
  canViewAnalytics: true,
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

const hourPattern = /^(\d{1,2})(?::(\d{2}))?$/;

const agentSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  role: z.string().min(2, 'Peran minimal 2 karakter').max(100, 'Peran maksimal 100 karakter'),
  tone: z.string().min(2, 'Gaya bahasa minimal 2 karakter').max(100, 'Gaya bahasa maksimal 100 karakter'),
  persona: z.string().min(10, 'Persona minimal 10 karakter'),
  goal: z.string().min(10, 'Tujuan minimal 10 karakter'),
  assignedSkills: z.array(z.string()).optional(),
  appointmentSchedulerConfig: z.object({
    enableBooking: z.boolean().optional(),
    enableReschedule: z.boolean().optional(),
    enableCancellation: z.boolean().optional(),
    enableReminder: z.boolean().optional(),
    enableAutoSuggestSlot: z.boolean().optional(),
    defaultMeetingDuration: z.coerce.number().int().min(15).max(480).optional(),
    workingHoursStart: z.string().regex(hourPattern, 'Jam mulai tidak valid').optional(),
    workingHoursEnd: z.string().regex(hourPattern, 'Jam selesai tidak valid').optional(),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    timezone: z.string().min(1).max(120).optional(),
  }).optional(),
  crmPipelineConfig: z.object({
    canManagePipeline: z.boolean().optional(),
    canMoveStage: z.boolean().optional(),
    canAssignLead: z.boolean().optional(),
    canViewAnalytics: z.boolean().optional(),
  }).optional(),
  systemPrompt: z.string().max(12000, 'System prompt maksimal 12000 karakter').optional(),
  sharedWorkspaceAccess: z.enum(['none', 'ro', 'rw']).optional(),
  accessMode: z.enum(['OPEN_ACCESS', 'APPROVAL_REQUIRED']).optional(),
});

function normalizeAssignedSkills(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((skill) => String(skill || '').trim()).filter(Boolean))]
    : [];
}

function normalizeTimeValue(value, fallback) {
  const normalized = String(value || '').trim();
  const match = normalized.match(hourPattern);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] || '00');
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return fallback;
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeAppointmentSchedulerConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const workingDays = Array.isArray(raw.workingDays)
    ? [...new Set(raw.workingDays
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right)
    : APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.workingDays;

  return {
    enableBooking: raw.enableBooking ?? APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.enableBooking,
    enableReschedule: raw.enableReschedule ?? APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.enableReschedule,
    enableCancellation: raw.enableCancellation ?? APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.enableCancellation,
    enableReminder: raw.enableReminder ?? APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.enableReminder,
    enableAutoSuggestSlot: raw.enableAutoSuggestSlot ?? APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.enableAutoSuggestSlot,
    defaultMeetingDuration: Number(raw.defaultMeetingDuration) > 0
      ? Number(raw.defaultMeetingDuration)
      : APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.defaultMeetingDuration,
    workingHoursStart: normalizeTimeValue(raw.workingHoursStart, APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.workingHoursStart),
    workingHoursEnd: normalizeTimeValue(raw.workingHoursEnd, APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.workingHoursEnd),
    workingDays,
    timezone: String(raw.timezone || APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.timezone).trim() || APPOINTMENT_SCHEDULER_DEFAULT_CONFIG.timezone,
  };
}

function readAgentAppointmentSchedulerConfig(agent) {
  return normalizeAppointmentSchedulerConfig(
    agent?.configJson?.skillConfigs?.[INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER]
      || agent?.configJson?.appointmentSchedulerConfig
      || agent?.configJson?.appointmentScheduler
      || {},
  );
}

function normalizeCrmPipelineConfig(value) {
  const raw = value && typeof value === 'object' ? value : {};

  return {
    canManagePipeline: raw.canManagePipeline ?? CRM_PIPELINE_DEFAULT_CONFIG.canManagePipeline,
    canMoveStage: raw.canMoveStage ?? CRM_PIPELINE_DEFAULT_CONFIG.canMoveStage,
    canAssignLead: raw.canAssignLead ?? CRM_PIPELINE_DEFAULT_CONFIG.canAssignLead,
    canViewAnalytics: raw.canViewAnalytics ?? CRM_PIPELINE_DEFAULT_CONFIG.canViewAnalytics,
  };
}

function readAgentCrmPipelineConfig(agent) {
  return normalizeCrmPipelineConfig(
    agent?.configJson?.skillConfigs?.[INTERNAL_SKILL_KEYS.CRM_PIPELINE]
      || agent?.configJson?.crmPipelineConfig
      || agent?.configJson?.crmPipeline
      || {},
  );
}

function normalizeSharedWorkspaceAccess(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'ro', 'rw'].includes(normalized) ? normalized : 'none';
}

function buildGeneratedPrompt(data) {
  const assignedSkills = normalizeAssignedSkills(data.assignedSkills);
  const sharedWorkspaceAccess = normalizeSharedWorkspaceAccess(data.sharedWorkspaceAccess);
  const sharedWorkspaceLine = sharedWorkspaceAccess === 'none'
    ? 'Shared Workspace: Tidak aktif'
    : `Shared Workspace: ${sharedWorkspaceAccess === 'ro' ? 'Read-only' : 'Read-write'}`;

  return `Kamu adalah ${data.name || '[Nama Agent]'}, AI assistant dengan peran ${data.role || '[Peran]'}.\n\nKarakter: ${data.persona || '[Belum diisi]'}\n\nGaya Bahasa: ${data.tone || '[Belum dipilih]'}\n\nTujuan Utama:\n${data.goal || '[Belum diisi]'}\n\nSkill Aktif: ${assignedSkills.length > 0 ? assignedSkills.join(', ') : 'Tidak ada'}\n\n${sharedWorkspaceLine}\n\nGunakan Bahasa Indonesia secara default, tetapi ikuti bahasa user bila berbeda. Gunakan skill yang tersedia saat relevan, terutama skill aktif yang sesuai konteks.`;
}

function buildEffectivePrompt(data, rolePreset) {
  const customPrompt = String(data.systemPrompt || '').trim();
  if (customPrompt) {
    return customPrompt;
  }

  const presetPreview = String(rolePreset?.systemPromptPreview || '').trim();
  if (presetPreview) {
    return presetPreview;
  }

  const hasStructuredFields = [data.tone, data.persona, data.goal].some((value) => String(value || '').trim());
  return hasStructuredFields ? buildGeneratedPrompt(data) : '';
}

function RolePresetButton({ preset, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(preset)}
      title={preset.description}
      className={cn(
        'rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        selected
          ? 'border-blue-400 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.35)]'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{preset.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{preset.description}</p>
        </div>
        <span title={preset.description} className="shrink-0 rounded-full border border-slate-600 p-1 text-slate-400">
          <CircleHelp className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

export default function AgentFormPage() {
  const router = useRouter();
  const params = useParams();
  const isNew = params.id === 'new';
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [workspaceId, setWorkspaceId] = useState(null);
  const [preview, setPreview] = useState('');
  const [installedSkills, setInstalledSkills] = useState([]);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [selectedRoleKey, setSelectedRoleKey] = useState(DEFAULT_ROLE_KEY);
  const [approvalCode, setApprovalCode] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      name: '',
      role: DEFAULT_ROLE_PRESET?.roleValue || 'Customer Service',
      tone: DEFAULT_ROLE_PRESET?.tone || 'Ramah',
      persona: DEFAULT_ROLE_PRESET?.persona || '',
      goal: DEFAULT_ROLE_PRESET?.goal || '',
      assignedSkills: [],
      appointmentSchedulerConfig: APPOINTMENT_SCHEDULER_DEFAULT_CONFIG,
      crmPipelineConfig: CRM_PIPELINE_DEFAULT_CONFIG,
      systemPrompt: '',
      sharedWorkspaceAccess: 'none',
      accessMode: 'OPEN_ACCESS',
    },
  });

  const watchAll = watch();
  const selectedSkills = normalizeAssignedSkills(watchAll.assignedSkills);
  const appointmentSchedulerSelected = selectedSkills.includes(INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER);
  const appointmentSchedulerConfig = normalizeAppointmentSchedulerConfig(watchAll.appointmentSchedulerConfig);
  const crmPipelineSelected = selectedSkills.includes(INTERNAL_SKILL_KEYS.CRM_PIPELINE);
  const crmPipelineConfig = normalizeCrmPipelineConfig(watchAll.crmPipelineConfig);
  const availableAdvancedRoles = getAvailableAdvancedRolePresets(installedSkills, selectedSkills);
  const selectedRolePreset = getRolePresetByKey(selectedRoleKey) || getRolePresetByRoleName(watchAll.role) || DEFAULT_ROLE_PRESET;
  const selectedAccessMode = watchAll.accessMode || 'OPEN_ACCESS';
  const selectedAccessModeOption = ACCESS_MODE_OPTIONS.find((option) => option.value === selectedAccessMode) || ACCESS_MODE_OPTIONS[0];

  useEffect(() => {
    setPreview(buildEffectivePrompt(watchAll, selectedRolePreset));
  }, [selectedRolePreset, JSON.stringify(watchAll)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      try {
        const { data: me } = await api.get('/auth/me');
        const currentTier = me.workspace?.subTier || 'FREE';
        const canUseSkills = currentTier !== 'FREE';

        setWorkspaceId(me.workspace?.id);
        setWorkspaceTier(currentTier);

        if (canUseSkills) {
          const { data: skillsData } = await api.get('/skills/installed');
          setInstalledSkills(skillsData.skills ?? []);
        } else {
          setInstalledSkills([]);
        }

        if (!isNew) {
          const { data } = await api.get(`/agents/${params.id}`);
          const agent = data.agent;
          const roleValue = agent.configJson?.role || DEFAULT_ROLE_PRESET?.roleValue || 'Customer Service';
          const matchedPreset = getRolePresetByRoleName(roleValue) || getRolePresetByKey('custom');
          const assignedSkills = canUseSkills
            ? normalizeAssignedSkills(agent.configJson?.assignedSkills || (agent.openclawSkill ? [agent.openclawSkill] : []))
            : [];

          reset({
            name: agent.name,
            role: roleValue,
            tone: agent.tone || 'Ramah',
            persona: agent.persona,
            goal: agent.goal,
            assignedSkills,
            appointmentSchedulerConfig: readAgentAppointmentSchedulerConfig(agent),
            crmPipelineConfig: readAgentCrmPipelineConfig(agent),
            systemPrompt: agent.configJson?.systemPrompt || '',
            sharedWorkspaceAccess: currentTier === 'FREE'
              ? 'none'
              : normalizeSharedWorkspaceAccess(agent.configJson?.sharedWorkspaceAccess),
            accessMode: agent.accessMode || 'OPEN_ACCESS',
          });
          setApprovalCode(agent.approvalCode || '');
          setSelectedRoleKey(matchedPreset?.key || 'custom');
        } else {
          setApprovalCode('');
        }
      } catch {
        setError('Gagal memuat data');
      } finally {
        setLoadingSkills(false);
        setLoading(false);
      }
    }

    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (data) => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...data,
        assignedSkills: workspaceTier === 'FREE' ? [] : normalizeAssignedSkills(data.assignedSkills),
        appointmentSchedulerConfig: workspaceTier === 'FREE' || !normalizeAssignedSkills(data.assignedSkills).includes(INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER)
          ? undefined
          : normalizeAppointmentSchedulerConfig(data.appointmentSchedulerConfig),
        crmPipelineConfig: workspaceTier === 'FREE' || !normalizeAssignedSkills(data.assignedSkills).includes(INTERNAL_SKILL_KEYS.CRM_PIPELINE)
          ? undefined
          : normalizeCrmPipelineConfig(data.crmPipelineConfig),
        systemPrompt: data.systemPrompt || '',
        sharedWorkspaceAccess: workspaceTier === 'FREE'
          ? 'none'
          : normalizeSharedWorkspaceAccess(data.sharedWorkspaceAccess),
        accessMode: data.accessMode || 'OPEN_ACCESS',
      };

      if (isNew) {
        await api.post('/agents', { ...payload, workspaceId });
      } else {
        await api.patch(`/agents/${params.id}`, payload);
      }
      router.push('/dashboard/agents');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan agent');
    } finally {
      setSaving(false);
    }
  };

  const toggleSkill = (skillKey) => {
    const nextSkills = selectedSkills.includes(skillKey)
      ? selectedSkills.filter((skill) => skill !== skillKey)
      : [...selectedSkills, skillKey];

    setValue('assignedSkills', nextSkills, { shouldDirty: true, shouldValidate: true });
  };

  const toggleAppointmentWorkingDay = (dayValue) => {
    const nextDays = appointmentSchedulerConfig.workingDays.includes(dayValue)
      ? appointmentSchedulerConfig.workingDays.filter((day) => day !== dayValue)
      : [...appointmentSchedulerConfig.workingDays, dayValue].sort((left, right) => left - right);

    setValue('appointmentSchedulerConfig.workingDays', nextDays, { shouldDirty: true, shouldValidate: true });
  };

  const setAppointmentSchedulerField = (field, value) => {
    setValue(`appointmentSchedulerConfig.${field}`, value, { shouldDirty: true, shouldValidate: true });
  };

  const setCrmPipelineField = (field, value) => {
    setValue(`crmPipelineConfig.${field}`, value, { shouldDirty: true, shouldValidate: true });
  };

  const applyRolePreset = (preset) => {
    setSelectedRoleKey(preset.key);
    setValue('role', preset.roleValue, { shouldDirty: true });
    setValue('tone', preset.tone || '', { shouldDirty: true });
    setValue('persona', preset.persona || '', { shouldDirty: true });
    setValue('goal', preset.goal || '', { shouldDirty: true });
    setValue('systemPrompt', '', { shouldDirty: true });

    const matchedSkill = findMatchingInstalledSkill(preset, installedSkills);
    if (matchedSkill?.skillKey && !selectedSkills.includes(matchedSkill.skillKey)) {
      setValue('assignedSkills', [...selectedSkills, matchedSkill.skillKey], { shouldDirty: true });
    }
  };

  if (loading || loadingSkills) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/agents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-white">{isNew ? 'Buat Agent Baru' : 'Edit Agent'}</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isNew && (
        <Alert className="border-sky-800 bg-sky-950/40 text-sky-50">
          <AlertDescription className="space-y-2 text-sm">
            <p className="font-medium">Setelah agent dibuat, Anda bisa menghubungkannya ke Telegram Bot atau WhatsApp.</p>
            <ol className="list-decimal space-y-1 pl-5 text-sky-100/90">
              <li>Jika ingin memakai Telegram, buka <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline underline-offset-4">t.me/BotFather</a>, buat bot baru, lalu simpan tokennya.</li>
              <li>Jika ingin memakai WhatsApp, Anda cukup menyiapkan nomor yang akan dipakai untuk scan QR setelah agent dibuat.</li>
              <li>Setelah agent dibuat, buka <Link href="/dashboard/channels" className="underline underline-offset-4">halaman Channels</Link> untuk menghubungkan channel ke agent ini.</li>
            </ol>
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle className="text-base">Identitas Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nama Agent</Label>
              <Input {...register('name')} placeholder="Contoh: Sari CS" className="bg-slate-800 border-slate-700" />
              {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Role Utama</Label>
                  <p className="text-xs text-slate-400">
                    Klik role untuk auto-fill tone, persona, goal, dan preview prompt. Setelah itu semua field tetap bisa Anda edit manual.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {MAIN_ROLE_PRESETS_MAP.map((preset) => (
                    <RolePresetButton
                      key={preset.key}
                      preset={preset}
                      selected={selectedRoleKey === preset.key}
                      onSelect={applyRolePreset}
                    />
                  ))}
                </div>
              </div>

              {availableAdvancedRoles.length > 0 && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label>Advanced Roles</Label>
                    <p className="text-xs text-slate-400">
                      Role ini muncul ketika skill premium terkait sudah aktif di workspace, atau sedang Anda pilih untuk agent ini.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {availableAdvancedRoles.map((preset) => (
                      <RolePresetButton
                        key={preset.key}
                        preset={preset}
                        selected={selectedRoleKey === preset.key}
                        onSelect={applyRolePreset}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Peran / Role</Label>
                <Input
                  {...register('role')}
                  placeholder={selectedRoleKey === 'custom' ? 'Contoh: Admin Assistant Internal' : 'Role akan terisi otomatis, tetapi masih bisa diubah manual'}
                  className="bg-slate-800 border-slate-700"
                />
                <p className="text-xs text-slate-400">Nilai ini bisa Anda ubah manual meskipun sebelumnya memilih preset role.</p>
                {errors.role && <p className="text-xs text-red-400">{errors.role.message}</p>}
              </div>

              <div className="space-y-2">
                <Label>Gaya Bahasa</Label>
                <Select onValueChange={(value) => setValue('tone', value, { shouldDirty: true, shouldValidate: true })} value={watchAll.tone || undefined}>
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Pilih gaya bahasa" />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_PRESETS.map((tone) => (
                      <SelectItem key={tone} value={tone}>{tone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.tone && <p className="text-xs text-red-400">{errors.tone.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Persona</Label>
              <Textarea
                {...register('persona')}
                placeholder="Deskripsi karakter agent, misalnya: analis yang tenang, disiplin, dan fokus pada pengambilan keputusan berbasis data..."
                className="bg-slate-800 border-slate-700 min-h-[100px]"
              />
              {errors.persona && <p className="text-xs text-red-400">{errors.persona.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Tujuan Utama</Label>
              <Textarea
                {...register('goal')}
                placeholder="Apa yang harus agent capai? Misalnya: membantu riset trading, menyusun analisis, atau mendampingi pelanggan sampai closing."
                className="bg-slate-800 border-slate-700 min-h-[80px]"
              />
              {errors.goal && <p className="text-xs text-red-400">{errors.goal.message}</p>}
            </div>

            {workspaceTier === 'FREE' ? (
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <Label>Skill Aktif</Label>
                <p className="text-sm text-slate-300">
                  Paket FREE belum mendukung fitur skill agent.
                </p>
                <p className="text-xs text-slate-500">
                  Upgrade ke STARTER atau lebih tinggi jika ingin install dan assign skill.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>Skill Aktif</Label>
                  <button
                    type="button"
                    onClick={() => setValue('assignedSkills', [], { shouldDirty: true, shouldValidate: true })}
                    className="text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline"
                  >
                    Hapus semua skill
                  </button>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-3">
                  {installedSkills.length === 0 ? (
                    <p className="text-xs text-amber-400">
                      Belum ada skill terinstall. Buka <Link href="/dashboard/skills" className="underline">halaman Skills</Link> untuk install internal skill yang dibutuhkan.
                    </p>
                  ) : (
                    installedSkills.map((skill) => {
                      const checked = selectedSkills.includes(skill.skillKey);

                      return (
                        <label
                          key={skill.skillKey}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition ${checked ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-900"
                            checked={checked}
                            onChange={() => toggleSkill(skill.skillKey)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">{skill.displayName}</p>
                            <p className="text-xs text-slate-400">{skill.skillKey}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {Number(skill.assignedCount || 0) > 0
                                ? `Aktif di ${skill.assignedCount} agent`
                                : 'Sudah terinstall, belum aktif di agent lain'}
                            </p>
                            {skill.skillKey === 'payment-reminder' && (
                              <p className="mt-2 text-[11px] text-sky-300">
                                Unlocks Billing Assistant role dan membuat agent ini siap dipakai untuk reminder pembayaran.
                              </p>
                            )}
                            {skill.skillKey === INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER && (
                              <p className="mt-2 text-[11px] text-sky-300">
                                Unlocks Scheduler Assistant, Sales Assistant, dan Support Coordinator sekaligus menyalakan config slot availability agent.
                              </p>
                            )}
                            {skill.skillKey === INTERNAL_SKILL_KEYS.CRM_PIPELINE && (
                              <p className="mt-2 text-[11px] text-sky-300">
                                Unlocks Lead Qualification role, CRM Pipeline dashboard, dan capability agent untuk manage pipeline, move stage, assign lead, serta view analytics.
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Anda bisa mengaktifkan lebih dari satu skill untuk agent berlangganan. Semua skill terpilih akan tersedia saat runtime.
                </p>
                {selectedSkills.length > 0 && (
                  <p className="text-xs text-blue-300">
                    Skill aktif saat ini: {selectedSkills.join(', ')}
                  </p>
                )}

                {appointmentSchedulerSelected && (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-4">
                    <div className="space-y-1">
                      <Label>Appointment Scheduler Capability</Label>
                      <p className="text-xs text-sky-100/80">
                        Konfigurasi ini menentukan apakah agent boleh menerima booking, reschedule, cancellation, reminder, dan auto-suggest slot.
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        ['enableBooking', 'Enable Booking'],
                        ['enableReschedule', 'Enable Reschedule'],
                        ['enableCancellation', 'Enable Cancellation'],
                        ['enableReminder', 'Enable Reminder'],
                        ['enableAutoSuggestSlot', 'Enable Auto Suggest Slot'],
                      ].map(([field, label]) => (
                        <label key={field} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                            checked={Boolean(appointmentSchedulerConfig[field])}
                            onChange={(event) => setAppointmentSchedulerField(field, event.target.checked)}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Default Meeting Duration (minutes)</Label>
                        <Input
                          type="number"
                          min="15"
                          max="480"
                          className="bg-slate-900 border-slate-700"
                          value={appointmentSchedulerConfig.defaultMeetingDuration}
                          onChange={(event) => setAppointmentSchedulerField('defaultMeetingDuration', Number(event.target.value || 60))}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Timezone</Label>
                        <Input
                          className="bg-slate-900 border-slate-700"
                          value={appointmentSchedulerConfig.timezone}
                          onChange={(event) => setAppointmentSchedulerField('timezone', event.target.value)}
                          placeholder="Asia/Jakarta"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Working Hours Start</Label>
                        <Input
                          className="bg-slate-900 border-slate-700"
                          value={appointmentSchedulerConfig.workingHoursStart}
                          onChange={(event) => setAppointmentSchedulerField('workingHoursStart', event.target.value)}
                          placeholder="09:00"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Working Hours End</Label>
                        <Input
                          className="bg-slate-900 border-slate-700"
                          value={appointmentSchedulerConfig.workingHoursEnd}
                          onChange={(event) => setAppointmentSchedulerField('workingHoursEnd', event.target.value)}
                          placeholder="17:00"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Working Days</Label>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAY_OPTIONS.map((option) => {
                          const selected = appointmentSchedulerConfig.workingDays.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => toggleAppointmentWorkingDay(option.value)}
                              className={cn(
                                'rounded-full border px-3 py-2 text-xs font-medium transition',
                                selected
                                  ? 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                                  : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white',
                              )}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 space-y-2">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Slot Availability Preview</p>
                      <p className="text-sm text-slate-200">
                        {appointmentSchedulerConfig.workingDays.length > 0
                          ? `${appointmentSchedulerConfig.workingDays
                            .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label || day)
                            .join(', ')} · ${appointmentSchedulerConfig.workingHoursStart} - ${appointmentSchedulerConfig.workingHoursEnd} · ${appointmentSchedulerConfig.timezone}`
                          : 'Belum ada hari kerja yang dipilih.'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Backend akan menyinkronkan preview ini ke tabel availability agent untuk validasi booking dan reminder worker.
                      </p>
                    </div>
                  </div>
                )}

                {crmPipelineSelected && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-4">
                    <div className="space-y-1">
                      <Label>CRM Pipeline Capability</Label>
                      <p className="text-xs text-emerald-100/80">
                        Konfigurasi ini menentukan apakah agent boleh mengelola pipeline, memindahkan stage, assign lead, dan melihat analytics CRM.
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        ['canManagePipeline', 'Can Manage Pipeline'],
                        ['canMoveStage', 'Can Move Stage'],
                        ['canAssignLead', 'Can Assign Lead'],
                        ['canViewAnalytics', 'Can View Analytics'],
                      ].map(([field, label]) => (
                        <label key={field} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                          <span>{label}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                            checked={Boolean(crmPipelineConfig[field])}
                            onChange={(event) => setCrmPipelineField(field, event.target.checked)}
                          />
                        </label>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 space-y-2">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Capability Summary</p>
                      <p className="text-sm text-slate-200">
                        {Object.entries(crmPipelineConfig)
                          .filter(([, enabled]) => Boolean(enabled))
                          .map(([field]) => field)
                          .join(', ') || 'Belum ada capability CRM yang aktif.'}
                      </p>
                      <p className="text-xs text-slate-400">
                        Nilai ini dikirim ke runtime agent melalui skill config map sehingga capability CRM hilang otomatis saat skill dilepas atau diuninstall.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {workspaceTier !== 'FREE' && (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                <div className="space-y-1">
                  <Label>Shared Workspace</Label>
                  <p className="text-xs text-slate-400">
                    Folder bersama ini tersedia untuk kolaborasi file antar agent dalam owner yang sama.
                  </p>
                </div>
                <Select
                  onValueChange={(value) => setValue('sharedWorkspaceAccess', value, { shouldDirty: true, shouldValidate: true })}
                  value={normalizeSharedWorkspaceAccess(watchAll.sharedWorkspaceAccess)}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHARED_WORKSPACE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
                  {SHARED_WORKSPACE_OPTIONS.find((option) => option.value === normalizeSharedWorkspaceAccess(watchAll.sharedWorkspaceAccess))?.description}
                </div>
                <p className="text-xs text-slate-500">
                  Folder yang diproyeksikan ke agent bernama <span className="font-mono">shared-workspace</span>.
                </p>
                {errors.sharedWorkspaceAccess && <p className="text-xs text-red-400">{errors.sharedWorkspaceAccess.message}</p>}
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
              <div className="space-y-1">
                <Label>Access Mode</Label>
                <p className="text-xs text-slate-400">
                  Atur apakah customer bisa langsung berbicara dengan agent, atau harus melewati approval terlebih dahulu.
                </p>
              </div>
              <Select
                onValueChange={(value) => setValue('accessMode', value, { shouldDirty: true, shouldValidate: true })}
                value={selectedAccessMode}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700">
                  <SelectValue placeholder="Pilih access mode" />
                </SelectTrigger>
                <SelectContent>
                  {ACCESS_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300 space-y-1">
                <p className="font-medium text-white">{selectedAccessModeOption.label}</p>
                <p>{selectedAccessModeOption.description}</p>
                <p className="text-slate-400">{selectedAccessModeOption.recommendation}</p>
              </div>
              {selectedAccessMode === 'APPROVAL_REQUIRED' && (
                <div className="space-y-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
                  <Label>Approval Code</Label>
                  <Input
                    value={approvalCode || 'Akan dibuat otomatis setelah agent disimpan'}
                    readOnly
                    className="bg-slate-900 border-slate-700 font-mono tracking-[0.2em]"
                  />
                  <p className="text-xs text-slate-400">
                    Customer harus mengirim kode ini agar bisa pindah dari pending ke aktif.
                  </p>
                </div>
              )}
              {errors.accessMode && <p className="text-xs text-red-400">{errors.accessMode.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Custom System Prompt</Label>
              <Textarea
                {...register('systemPrompt')}
                placeholder={selectedRolePreset?.systemPromptPlaceholder || ''}
                className="bg-slate-800 border-slate-700 min-h-[180px]"
              />
              <p className="text-xs text-slate-400">
                Jika dikosongkan, sistem akan membuat prompt otomatis dari role, persona, tone, goal, dan skill aktif.
              </p>
              {errors.systemPrompt && <p className="text-xs text-red-400">{errors.systemPrompt.message}</p>}
            </div>
          </CardContent>
        </Card>

        <Accordion type="single" collapsible>
          <AccordionItem value="preview" className="border-slate-800">
            <AccordionTrigger className="text-sm text-slate-400 hover:text-white">
              Preview Prompt Aktif
            </AccordionTrigger>
            <AccordionContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-slate-800/60 rounded p-3 border border-slate-700">
                {preview}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? 'Buat Agent' : 'Simpan Perubahan'}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/agents">Batal</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}