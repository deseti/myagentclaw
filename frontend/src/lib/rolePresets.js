const MAIN_ROLE_PRESETS = [
  {
    key: 'customer-service',
    roleValue: 'Customer Service',
    label: 'Customer Service',
    description: 'Menjawab FAQ, pertanyaan umum, dan kebutuhan pelanggan harian.',
    tone: 'Ramah',
    persona: 'Cepat, sopan, membantu pelanggan, fokus menjawab FAQ dan pertanyaan umum',
    goal: 'Menjawab pertanyaan pelanggan dengan cepat dan jelas',
    systemPromptPreview: 'Anda adalah customer service yang ramah, cepat, dan membantu. Fokus membantu pelanggan terkait FAQ, produk, pembayaran, jam operasional, dan pertanyaan umum.',
    systemPromptPlaceholder: 'Anda adalah customer service yang ramah, cepat, dan membantu. Fokus membantu pelanggan terkait FAQ, produk, pembayaran, jam operasional, dan pertanyaan umum.',
    group: 'main',
  },
  {
    key: 'sales',
    roleValue: 'Sales',
    label: 'Sales',
    description: 'Mendorong closing, upsell, dan percakapan yang berorientasi penjualan.',
    tone: 'Persuasif',
    persona: 'Aktif, percaya diri, fokus closing, upsell, dan penjualan',
    goal: 'Membantu meningkatkan penjualan dan closing',
    systemPromptPreview: 'Anda adalah sales assistant yang fokus membantu closing, upsell, follow-up prospek, dan mendorong pelanggan untuk melakukan pembelian.',
    systemPromptPlaceholder: 'Anda adalah sales assistant yang fokus membantu closing, upsell, follow-up prospek, dan mendorong pelanggan untuk melakukan pembelian.',
    group: 'main',
  },
  {
    key: 'follow-up',
    roleValue: 'Follow-up',
    label: 'Follow-up',
    description: 'Menjaga komunikasi, reminder, dan follow-up tanpa terasa agresif.',
    tone: 'Santai',
    persona: 'Friendly, persisten, tidak terlalu agresif, fokus reminder dan follow-up',
    goal: 'Mengingatkan pelanggan tanpa terasa spam',
    systemPromptPreview: 'Anda adalah follow-up assistant yang bertugas mengingatkan pelanggan, mengecek progress, mengirim reminder pembayaran, dan menjaga engagement.',
    systemPromptPlaceholder: 'Anda adalah follow-up assistant yang bertugas mengingatkan pelanggan, mengecek progress, mengirim reminder pembayaran, dan menjaga engagement.',
    group: 'main',
  },
  {
    key: 'research-assistant',
    roleValue: 'Research Assistant',
    label: 'Research Assistant',
    description: 'Menyusun analisis, rangkuman, dan insight berbasis data.',
    tone: 'Netral',
    persona: 'Analitis, tenang, detail, fokus data dan insight',
    goal: 'Memberikan hasil analisis dan ringkasan yang akurat',
    systemPromptPreview: 'Anda adalah research assistant yang fokus membantu analisis, market research, rangkuman, dan insight berbasis data.',
    systemPromptPlaceholder: 'Anda adalah research assistant yang fokus membantu analisis, market research, rangkuman, dan insight berbasis data.',
    group: 'main',
  },
  {
    key: 'custom',
    roleValue: 'Custom',
    label: 'Custom',
    description: 'Mulai dari kosong lalu bentuk role sesuai kebutuhan bisnis Anda.',
    tone: '',
    persona: '',
    goal: '',
    systemPromptPreview: '',
    systemPromptPlaceholder: '',
    group: 'main',
  },
];

const ADVANCED_ROLE_PRESETS = [
  {
    key: 'polymarket-analyst',
    roleValue: 'Polymarket Analyst',
    label: 'Polymarket Analyst',
    description: 'Analisis market prediction dan peluang trade berbasis probabilitas.',
    tone: 'Netral',
    persona: 'Data-driven, disiplin, fokus probabilitas dan market prediction',
    goal: 'Membantu analisis market prediction dan peluang trade',
    systemPromptPreview: '',
    systemPromptPlaceholder: 'Opsional. Tambahkan guardrail, market scope, atau gaya analisis khusus untuk agent Polymarket.',
    group: 'advanced',
    skillMatchers: ['polymarket-read-only', 'polymarket'],
  },
  {
    key: 'billing-assistant',
    roleValue: 'Billing Assistant',
    label: 'Billing Assistant',
    description: 'Mengelola reminder pembayaran dan komunikasi tagihan secara profesional.',
    tone: 'Formal',
    persona: 'Sopan, profesional, jelas, fokus reminder pembayaran',
    goal: 'Membantu reminder pembayaran, invoice, DP, cicilan, dan tagihan subscription',
    systemPromptPreview: '',
    systemPromptPlaceholder: 'Opsional. Tambahkan aturan reminder, tempo follow-up, atau format komunikasi billing.',
    group: 'advanced',
    skillMatchers: ['payment-reminder', 'payment reminder', 'billing', 'invoice'],
  },
  {
    key: 'appointment-setter',
    roleValue: 'Appointment Setter',
    label: 'Appointment Setter',
    description: 'Membantu booking jadwal, konfirmasi meeting, dan koordinasi agenda.',
    tone: 'Ramah',
    persona: 'Terorganisir, cepat, profesional',
    goal: 'Membantu booking jadwal dan konfirmasi meeting',
    systemPromptPreview: '',
    systemPromptPlaceholder: 'Opsional. Tambahkan aturan jadwal, window booking, atau format konfirmasi meeting.',
    group: 'advanced',
    skillMatchers: ['appointment-scheduler', 'appointment scheduler', 'calendar', 'booking'],
  },
  {
    key: 'lead-qualification',
    roleValue: 'Lead Qualification',
    label: 'Lead Qualification',
    description: 'Screening lead sebelum diteruskan ke tim sales atau pipeline.',
    tone: 'Ramah',
    persona: 'Cepat, teliti, fokus screening',
    goal: 'Mengidentifikasi lead potensial sebelum masuk sales',
    systemPromptPreview: '',
    systemPromptPlaceholder: 'Opsional. Tambahkan kriteria lead, scoring, atau format handoff ke sales.',
    group: 'advanced',
    skillMatchers: ['crm', 'pipeline', 'lead'],
  },
  {
    key: 'admin-assistant',
    roleValue: 'Admin Assistant',
    label: 'Admin Assistant',
    description: 'Membantu pekerjaan administratif dan operasional internal.',
    tone: 'Formal',
    persona: 'Rapi, detail, disiplin',
    goal: 'Membantu tugas administratif dan operasional internal',
    systemPromptPreview: '',
    systemPromptPlaceholder: 'Opsional. Tambahkan SOP, checklist, atau batasan kerja administratif agent ini.',
    group: 'advanced',
    skillMatchers: ['internal-workflow', 'internal workflow', 'operations', 'ops'],
  },
];

const ROLE_PRESETS = [...MAIN_ROLE_PRESETS, ...ADVANCED_ROLE_PRESETS];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function buildSkillSearchText(skill) {
  return [skill?.skillKey, skill?.slug, skill?.displayName, skill?.name]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function buildSkillIdentifiers(skill) {
  return [skill?.skillKey, skill?.slug, skill?.displayName, skill?.name]
    .map(normalizeText)
    .filter(Boolean);
}

function isInstalledSkillActive(skill, activeSkillKeys = []) {
  const normalizedActiveSkillKeys = new Set(
    (Array.isArray(activeSkillKeys) ? activeSkillKeys : [])
      .map(normalizeText)
      .filter(Boolean),
  );

  if (buildSkillIdentifiers(skill).some((identifier) => normalizedActiveSkillKeys.has(identifier))) {
    return true;
  }

  return Boolean(skill?.isActive || Number(skill?.assignedCount || 0) > 0);
}

export function getRolePresetByKey(key) {
  return ROLE_PRESETS.find((preset) => preset.key === key) || null;
}

export function getRolePresetByRoleName(roleName) {
  const normalizedRole = normalizeText(roleName);
  return ROLE_PRESETS.find((preset) => normalizeText(preset.roleValue) === normalizedRole) || null;
}

export function findMatchingInstalledSkill(rolePreset, installedSkills = [], options = {}) {
  if (!rolePreset?.skillMatchers?.length) {
    return null;
  }

  const requireActive = Boolean(options.requireActive);
  const activeSkillKeys = Array.isArray(options.activeSkillKeys) ? options.activeSkillKeys : [];

  return installedSkills.find((skill) => {
    const skillText = buildSkillSearchText(skill);
    const matchesPreset = rolePreset.skillMatchers.some((matcher) => skillText.includes(normalizeText(matcher)));
    if (!matchesPreset) {
      return false;
    }

    return requireActive ? isInstalledSkillActive(skill, activeSkillKeys) : true;
  }) || null;
}

export function getAvailableAdvancedRolePresets(installedSkills = [], activeSkillKeys = []) {
  return ADVANCED_ROLE_PRESETS.filter((preset) => Boolean(findMatchingInstalledSkill(
    preset,
    installedSkills,
    { requireActive: true, activeSkillKeys },
  )));
}

export const MAIN_ROLE_PRESETS_MAP = MAIN_ROLE_PRESETS;
export const ADVANCED_ROLE_PRESETS_MAP = ADVANCED_ROLE_PRESETS;
export const TONE_PRESETS = [...new Set([
  ...ROLE_PRESETS.map((preset) => preset.tone).filter(Boolean),
  'Formal',
  'Santai',
  'Ramah',
  'Netral',
  'Persuasif',
  'Analitis',
])];
