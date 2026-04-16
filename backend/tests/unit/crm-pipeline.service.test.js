import { describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  mockListAgentsUsingSkill,
  mockMatchesSkillKey,
  mockGetInternalSkillDefinition,
  mockWorkspaceMeetsMinimumTier,
  mockFormatInternalSkillTierLabel,
  mockOcListInstalledSkills,
  mockEnsureWorkspaceRuntime,
} = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { findFirst: vi.fn() },
    crmPipeline: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    crmPipelineStage: { upsert: vi.fn() },
  },
  mockListAgentsUsingSkill: vi.fn(),
  mockMatchesSkillKey: vi.fn((skillLike, requiredSkillKey) => {
    const candidates = [
      skillLike?.skillKey,
      skillLike?.slug,
      skillLike?.name,
      skillLike,
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    return candidates.includes(String(requiredSkillKey || '').trim().toLowerCase());
  }),
  mockGetInternalSkillDefinition: vi.fn(() => ({ key: 'crm-pipeline', minimumTier: 'STARTER' })),
  mockWorkspaceMeetsMinimumTier: vi.fn(() => true),
  mockFormatInternalSkillTierLabel: vi.fn(() => 'Starter'),
  mockOcListInstalledSkills: vi.fn(),
  mockEnsureWorkspaceRuntime: vi.fn(),
}));

vi.mock('../../src/lib/prisma.js', () => ({ default: mockPrisma }));
vi.mock('../../src/lib/skill-activation.js', () => ({
  listAgentsUsingSkill: mockListAgentsUsingSkill,
  matchesSkillKey: mockMatchesSkillKey,
}));
vi.mock('../../src/lib/internal-skills.js', () => ({
  getInternalSkillDefinition: mockGetInternalSkillDefinition,
  workspaceMeetsMinimumTier: mockWorkspaceMeetsMinimumTier,
  formatInternalSkillTierLabel: mockFormatInternalSkillTierLabel,
}));
vi.mock('../../src/lib/openclaw-client.js', () => ({ ocListInstalledSkills: mockOcListInstalledSkills }));
vi.mock('../../src/lib/runtime-manager.js', () => ({ ensureWorkspaceRuntime: mockEnsureWorkspaceRuntime }));

import { buildCrmEntryWhere, buildDashboardMetrics } from '../../src/services/crm-pipeline.service.js';

function makeStage(overrides = {}) {
  return {
    id: 'stage-lead',
    name: 'Lead Masuk',
    position: 1,
    isClosedWon: false,
    isClosedLost: false,
    ...overrides,
  };
}

function makeEntry(overrides = {}) {
  const stage = overrides.stage || makeStage();
  return {
    id: 'entry-1',
    stageId: stage.id,
    stage,
    assignedAgentId: null,
    assignedAgent: null,
    valueAmount: 0,
    lastActivityAt: new Date('2026-04-12T10:00:00.000Z'),
    expectedCloseDate: new Date('2026-04-20T10:00:00.000Z'),
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('crm pipeline service helpers', () => {
  it('builds entry filters with workspace isolation and search clauses', () => {
    const dateFrom = new Date('2026-04-01T00:00:00.000Z');
    const dateTo = new Date('2026-04-30T23:59:59.000Z');

    const where = buildCrmEntryWhere({
      workspaceId: 'workspace-1',
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
      assignedAgentId: 'agent-1',
      priority: 'HIGH',
      source: 'Referral',
      search: 'Acme',
      dateFrom,
      dateTo,
    });

    expect(where).toMatchObject({
      workspaceId: 'workspace-1',
      isArchived: false,
      pipelineId: 'pipeline-1',
      stageId: 'stage-1',
      assignedAgentId: 'agent-1',
      priority: 'HIGH',
      source: { equals: 'Referral', mode: 'insensitive' },
      createdAt: { gte: dateFrom, lte: dateTo },
    });
    expect(where.OR).toHaveLength(5);
    expect(where.OR[0]).toEqual({ title: { contains: 'Acme', mode: 'insensitive' } });
  });

  it('omits archived filtering when explicitly requested', () => {
    const where = buildCrmEntryWhere({
      workspaceId: 'workspace-1',
      includeArchived: true,
    });

    expect(where.workspaceId).toBe('workspace-1');
    expect(where).not.toHaveProperty('isArchived');
  });

  it('calculates dashboard metrics for conversion, stale leads, and open pipeline value', () => {
    const stageLead = makeStage({ id: 'stage-lead', name: 'Lead Masuk', position: 1 });
    const stageProposal = makeStage({ id: 'stage-proposal', name: 'Proposal', position: 2 });
    const stageWon = makeStage({ id: 'stage-won', name: 'Won', position: 3, isClosedWon: true });
    const stageLost = makeStage({ id: 'stage-lost', name: 'Lost', position: 4, isClosedLost: true });

    const entries = [
      makeEntry({
        id: 'entry-open-fresh',
        stage: stageLead,
        valueAmount: 100000,
        lastActivityAt: new Date('2026-04-12T10:00:00.000Z'),
      }),
      makeEntry({
        id: 'entry-won',
        stage: stageWon,
        stageId: stageWon.id,
        assignedAgentId: 'agent-1',
        assignedAgent: { id: 'agent-1', name: 'Agent One' },
        valueAmount: 200000,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-05T10:00:00.000Z'),
        lastActivityAt: new Date('2026-04-05T10:00:00.000Z'),
      }),
      makeEntry({
        id: 'entry-lost',
        stage: stageLost,
        stageId: stageLost.id,
        valueAmount: 50000,
        createdAt: new Date('2026-04-02T10:00:00.000Z'),
        updatedAt: new Date('2026-04-06T10:00:00.000Z'),
        lastActivityAt: new Date('2026-04-06T10:00:00.000Z'),
      }),
      makeEntry({
        id: 'entry-open-stale',
        stage: stageProposal,
        stageId: stageProposal.id,
        valueAmount: 150000,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        lastActivityAt: new Date('2026-04-01T10:00:00.000Z'),
        expectedCloseDate: new Date('2026-04-10T10:00:00.000Z'),
      }),
    ];

    const activities = [
      {
        id: 'activity-stage-1',
        customerPipelineEntryId: 'entry-open-stale',
        type: 'STAGE_CHANGED',
        previousStageId: stageLead.id,
        newStageId: stageProposal.id,
        createdAt: new Date('2026-04-03T10:00:00.000Z'),
      },
      {
        id: 'activity-stage-2',
        customerPipelineEntryId: 'entry-open-fresh',
        type: 'APPOINTMENT_CREATED',
        previousStageId: stageLead.id,
        newStageId: stageProposal.id,
        createdAt: new Date('2026-04-12T10:00:00.000Z'),
      },
      {
        id: 'activity-won',
        customerPipelineEntryId: 'entry-won',
        type: 'WON',
        previousStageId: stageProposal.id,
        newStageId: stageWon.id,
        createdAt: new Date('2026-04-05T10:00:00.000Z'),
      },
      {
        id: 'activity-lost',
        customerPipelineEntryId: 'entry-lost',
        type: 'LOST',
        previousStageId: stageProposal.id,
        newStageId: stageLost.id,
        createdAt: new Date('2026-04-06T10:00:00.000Z'),
      },
    ];

    const metrics = buildDashboardMetrics(entries, activities, new Date('2026-04-15T10:00:00.000Z'));

    expect(metrics.stats).toMatchObject({
      totalLeads: 4,
      wonDeals: 1,
      lostDeals: 1,
      conversionRate: 50,
      totalPipelineValue: 250000,
      leadsWithoutActivity: 0,
    });
    expect(metrics.analytics).toMatchObject({
      averageDaysToClose: 4,
      averageValuePerDeal: 200000,
      staleLeadsCount: 1,
      topPerformingAgent: {
        id: 'agent-1',
        name: 'Agent One',
        deals: 1,
        value: 200000,
      },
      mostActiveStage: {
        stageId: 'stage-proposal',
        label: 'Proposal',
        count: 2,
      },
      stageWithMostDropOff: {
        stageId: 'stage-proposal',
        label: 'Proposal',
        count: 1,
      },
    });
    expect(metrics.charts.wonVsLost).toEqual([
      { label: 'Won', value: 1 },
      { label: 'Lost', value: 1 },
    ]);
    expect(metrics.charts.leadsPerStage).toEqual([
      { stageId: 'stage-lead', label: 'Lead Masuk', position: 1, value: 1 },
      { stageId: 'stage-proposal', label: 'Proposal', position: 2, value: 1 },
      { stageId: 'stage-won', label: 'Won', position: 3, value: 1 },
      { stageId: 'stage-lost', label: 'Lost', position: 4, value: 1 },
    ]);
  });
});