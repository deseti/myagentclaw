import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  mockMatchesSkillKey,
  mockGetInternalSkillDefinition,
  mockWorkspaceMeetsMinimumTier,
  mockFormatInternalSkillTierLabel,
  mockOcListInstalledSkills,
  mockEnsureWorkspaceRuntime,
} = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
    agent: { findMany: vi.fn(), count: vi.fn() },
    analyticsMetricSnapshot: { count: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    analyticsSummaryCache: { findUnique: vi.fn(), upsert: vi.fn() },
    conversation: { count: vi.fn(), findMany: vi.fn() },
    appointmentSchedule: { count: vi.fn(), findMany: vi.fn() },
    appointmentActivityLog: { findMany: vi.fn() },
    paymentReminder: { count: vi.fn(), findMany: vi.fn() },
    crmCustomerPipelineEntry: { findMany: vi.fn() },
    crmPipelineActivity: { findMany: vi.fn() },
    broadcastCampaign: { count: vi.fn(), findMany: vi.fn() },
    broadcastCampaignRecipient: { count: vi.fn(), findMany: vi.fn() },
    customer: { count: vi.fn(), findMany: vi.fn() },
    lead: { count: vi.fn(), findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    polymarketTradeAudit: { findMany: vi.fn() },
    polymarketAutopilotRun: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
  },
  mockMatchesSkillKey: vi.fn((skillLike, requiredSkillKey) => {
    const candidates = [
      skillLike?.skillKey,
      skillLike?.slug,
      skillLike?.name,
      skillLike,
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    return candidates.includes(String(requiredSkillKey || '').trim().toLowerCase());
  }),
  mockGetInternalSkillDefinition: vi.fn(() => ({ key: 'analytics-dashboard', minimumTier: 'STARTER' })),
  mockWorkspaceMeetsMinimumTier: vi.fn(() => true),
  mockFormatInternalSkillTierLabel: vi.fn(() => 'Starter'),
  mockOcListInstalledSkills: vi.fn(),
  mockEnsureWorkspaceRuntime: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({ default: mockPrisma }));
vi.mock('../../src/lib/skill-activation.js', () => ({ matchesSkillKey: mockMatchesSkillKey }));
vi.mock('../../src/lib/internal-skills.js', () => ({
  getInternalSkillDefinition: mockGetInternalSkillDefinition,
  workspaceMeetsMinimumTier: mockWorkspaceMeetsMinimumTier,
  formatInternalSkillTierLabel: mockFormatInternalSkillTierLabel,
}));
vi.mock('../../src/lib/openclaw-client.js', () => ({ ocListInstalledSkills: mockOcListInstalledSkills }));
vi.mock('../../src/lib/runtime-manager.js', () => ({ ensureWorkspaceRuntime: mockEnsureWorkspaceRuntime }));

import {
  AnalyticsDashboardServiceError,
  assertAnalyticsDashboardAccess,
  getAnalyticsStatus,
} from '../../src/services/analytics-dashboard.service.js';

function makeAgent(overrides = {}) {
  return {
    id: 'agent-1',
    name: 'Insights Agent',
    status: 'ACTIVE',
    accessMode: 'APPROVAL_REQUIRED',
    openclawSkill: null,
    updatedAt: new Date('2026-04-17T10:00:00.000Z'),
    configJson: {
      assignedSkills: ['analytics-dashboard'],
      skillConfigs: {
        'analytics-dashboard': {
          canViewAnalytics: true,
          canViewRevenueAnalytics: true,
          canViewAgentPerformance: true,
          canViewBroadcastAnalytics: true,
          canViewAppointmentAnalytics: true,
          canViewPaymentAnalytics: true,
        },
      },
    },
    ...overrides,
  };
}

describe('analytics dashboard service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
      name: 'Workspace Analytics',
      subTier: 'GROWTH',
      subStatus: 'ACTIVE',
    });
    mockEnsureWorkspaceRuntime.mockResolvedValue({ runtimeId: 'runtime-1' });
    mockPrisma.analyticsMetricSnapshot.count.mockResolvedValue(7);
  });

  it('returns analytics status for installed but inactive skill setups', async () => {
    mockOcListInstalledSkills.mockResolvedValue({
      skills: [
        {
          skillKey: 'analytics-dashboard',
          displayName: 'Analytics Dashboard',
          installedAt: '2026-04-17T09:00:00.000Z',
        },
      ],
    });
    mockPrisma.agent.findMany.mockResolvedValue([
      makeAgent({
        id: 'agent-open-access',
        name: 'Open Agent',
        accessMode: 'OPEN_ACCESS',
      }),
      makeAgent({
        id: 'agent-general',
        name: 'General Agent',
        configJson: { assignedSkills: ['crm-pipeline'] },
      }),
    ]);

    const result = await getAnalyticsStatus({
      ownerId: 'owner-1',
      workspaceId: 'workspace-1',
    });

    expect(result.skillStatus).toMatchObject({
      installed: true,
      active: false,
      assignedCount: 0,
      usageCount: 7,
    });
    expect(result.installedSkills).toHaveLength(1);
    expect(result.installedSkills[0]).toMatchObject({
      skillKey: 'analytics-dashboard',
      assignedCount: 1,
      isActive: true,
    });
    expect(result.availableAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-general', assignedSkills: ['crm-pipeline'] }),
      expect.objectContaining({ id: 'agent-open-access', assignedSkills: ['analytics-dashboard'] }),
    ]));
    expect(result.availableSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillKey: 'analytics-dashboard', installed: true }),
    ]));
    expect(result.assignedAgents).toEqual([]);
  });

  it('rejects access when analytics dashboard is not installed', async () => {
    mockOcListInstalledSkills.mockResolvedValue({
      skills: [{ skillKey: 'crm-pipeline', displayName: 'CRM Pipeline' }],
    });
    mockPrisma.agent.findMany.mockResolvedValue([makeAgent()]);

    await expect(assertAnalyticsDashboardAccess({
      ownerId: 'owner-1',
      workspaceId: 'workspace-1',
      requireActive: false,
    })).rejects.toMatchObject({
      name: 'AnalyticsDashboardServiceError',
      statusCode: 403,
      message: 'Skill built-in Analytics Dashboard belum diinstall untuk workspace ini.',
    });
  });

  it('preserves service error details when tier access is blocked', async () => {
    mockWorkspaceMeetsMinimumTier.mockReturnValue(false);

    await expect(getAnalyticsStatus({
      ownerId: 'owner-1',
      workspaceId: 'workspace-1',
    })).rejects.toBeInstanceOf(AnalyticsDashboardServiceError);

    await expect(getAnalyticsStatus({
      ownerId: 'owner-1',
      workspaceId: 'workspace-1',
    })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Analytics Dashboard memerlukan minimum paket Starter.',
    });
  });
});