import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockHandleOutbound,
  mockEnsureWorkspaceRuntime,
  mockOcListInstalledSkills,
  mockListAgentsUsingSkill,
  mockWorkspaceMeetsMinimumTier,
  mockGetInternalSkillDefinition,
  mockFormatInternalSkillTierLabel,
  mockAgentHasAssignedSkill,
  mockMatchesSkillKey,
  mockWorkspaceHasAssignedSkill,
  mockTx,
  mockPrisma,
} = vi.hoisted(() => {
  const mockHandleOutbound = vi.fn();
  const mockEnsureWorkspaceRuntime = vi.fn();
  const mockOcListInstalledSkills = vi.fn();
  const mockListAgentsUsingSkill = vi.fn();
  const mockWorkspaceMeetsMinimumTier = vi.fn();
  const mockGetInternalSkillDefinition = vi.fn();
  const mockFormatInternalSkillTierLabel = vi.fn();
  const mockAgentHasAssignedSkill = vi.fn();
  const mockMatchesSkillKey = vi.fn((skillLike, requiredSkillKey) => {
    const candidates = [
      skillLike?.skillKey,
      skillLike?.slug,
      skillLike?.name,
      skillLike?.displayName,
      skillLike,
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

    return candidates.includes(String(requiredSkillKey || '').trim().toLowerCase());
  });
  const mockWorkspaceHasAssignedSkill = vi.fn();

  const mockTx = {
    appointmentSchedule: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    appointmentActivityLog: {
      create: vi.fn(),
    },
  };

  const mockPrisma = {
    appointmentSchedule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    channel: {
      findFirst: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    mockHandleOutbound,
    mockEnsureWorkspaceRuntime,
    mockOcListInstalledSkills,
    mockListAgentsUsingSkill,
    mockWorkspaceMeetsMinimumTier,
    mockGetInternalSkillDefinition,
    mockFormatInternalSkillTierLabel,
    mockAgentHasAssignedSkill,
    mockMatchesSkillKey,
    mockWorkspaceHasAssignedSkill,
    mockTx,
    mockPrisma,
  };
});

vi.mock('../../src/lib/prisma.js', () => ({ default: mockPrisma }));
vi.mock('../../src/channels/gateway.js', () => ({ handleOutbound: mockHandleOutbound }));
vi.mock('../../src/lib/runtime-manager.js', () => ({ ensureWorkspaceRuntime: mockEnsureWorkspaceRuntime }));
vi.mock('../../src/lib/openclaw-client.js', () => ({ ocListInstalledSkills: mockOcListInstalledSkills }));
vi.mock('../../src/lib/internal-skills.js', () => ({
  getInternalSkillDefinition: mockGetInternalSkillDefinition,
  workspaceMeetsMinimumTier: mockWorkspaceMeetsMinimumTier,
  formatInternalSkillTierLabel: mockFormatInternalSkillTierLabel,
}));
vi.mock('../../src/lib/skill-activation.js', () => ({
  agentHasAssignedSkill: mockAgentHasAssignedSkill,
  listAgentsUsingSkill: mockListAgentsUsingSkill,
  matchesSkillKey: mockMatchesSkillKey,
  workspaceHasAssignedSkill: mockWorkspaceHasAssignedSkill,
}));

import {
  autoCompleteAppointment,
  claimMissedFollowUp,
  getAppointmentsNeeding1hReminder,
  getMissedAppointments,
  getTodayAppointments,
  markAppointmentMissed,
  markMissedFollowUpSent,
  rescheduleAppointment,
  sendAppointmentMissedFollowUp,
} from '../../src/services/appointment.service.js';

function makeAppointment(overrides = {}) {
  return {
    id: 'appointment-1',
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    customerId: 'customer-1',
    title: 'Demo appointment',
    description: 'Scheduler test appointment',
    appointmentType: 'DEMO',
    status: 'CONFIRMED',
    scheduledAt: new Date('2026-04-14T09:00:00.000Z'),
    endAt: new Date('2026-04-14T10:00:00.000Z'),
    timezone: 'Asia/Jakarta',
    locationType: 'ONLINE',
    meetingLink: 'https://example.test/meet',
    physicalLocation: null,
    notes: 'Internal notes',
    reminder24hSent: false,
    reminder1hSent: false,
    missedFollowUpSent: false,
    missedFollowUpSentAt: null,
    missedFollowUpLockedAt: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-04-14T08:00:00.000Z'),
    updatedAt: new Date('2026-04-14T08:00:00.000Z'),
    customer: {
      id: 'customer-1',
      name: 'Test Customer',
      phoneNumber: '6281234567890',
      isBlocked: false,
      isArchived: false,
    },
    agent: {
      id: 'agent-1',
      name: 'Agent One',
      status: 'ACTIVE',
    },
    activityLogs: [],
    ...overrides,
  };
}

function makeAgentConfig(overrides = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    status: 'ACTIVE',
    openclawSkill: 'appointment-scheduler',
    configJson: {
      assignedSkills: ['appointment-scheduler'],
      skillConfigs: {
        'appointment-scheduler': {
          enableBooking: true,
          enableReschedule: true,
          enableCancellation: true,
          enableReminder: true,
          enableAutoSuggestSlot: true,
          defaultMeetingDuration: 60,
          workingHoursStart: '00:00',
          workingHoursEnd: '23:59',
          workingDays: [0, 1, 2, 3, 4, 5, 6],
          timezone: 'Asia/Jakarta',
        },
      },
    },
    appointmentAvailabilities: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APPOINTMENT_DEV_MODE = 'false';
  process.env.APPOINTMENT_SEND_MISSED_FOLLOW_UP = 'true';

  mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockTx));
  mockGetInternalSkillDefinition.mockReturnValue({ key: 'appointment-scheduler', minimumTier: 'STARTER' });
  mockWorkspaceMeetsMinimumTier.mockReturnValue(true);
  mockFormatInternalSkillTierLabel.mockReturnValue('Starter');
  mockEnsureWorkspaceRuntime.mockResolvedValue({ mode: 'DEDICATED' });
  mockOcListInstalledSkills.mockResolvedValue({
    skills: [{ slug: 'appointment-scheduler', skillKey: 'appointment-scheduler' }],
  });
  mockListAgentsUsingSkill.mockResolvedValue([{ id: 'agent-1', name: 'Agent One', status: 'ACTIVE' }]);
  mockAgentHasAssignedSkill.mockReturnValue(true);
  mockWorkspaceHasAssignedSkill.mockResolvedValue(true);
});

describe('appointment service hardening', () => {
  it('builds the second reminder query with workspace isolation and catch-up window', async () => {
    process.env.APPOINTMENT_DEV_MODE = 'true';
    const now = new Date('2026-04-14T08:00:00.000Z');
    mockPrisma.appointmentSchedule.findMany.mockResolvedValue([
      makeAppointment({ id: 'appointment-a' }),
      makeAppointment({ id: 'appointment-b', scheduledAt: new Date('2026-04-14T08:00:30.000Z') }),
    ]);

    const results = await getAppointmentsNeeding1hReminder({
      workspaceIds: ['workspace-1'],
      now,
    });

    expect(results).toHaveLength(2);

    const query = mockPrisma.appointmentSchedule.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      workspaceId: { in: ['workspace-1'] },
      status: { in: ['CONFIRMED', 'RESCHEDULED'] },
      completedAt: null,
      cancelledAt: null,
      reminder1hSent: false,
    });
    expect(query.where.scheduledAt.gt.toISOString()).toBe(new Date(now.getTime() - 90_000).toISOString());
    expect(query.where.scheduledAt.lte.toISOString()).toBe(new Date(now.getTime() + 60_000).toISOString());
  });

  it('builds the missed query so completed and cancelled appointments are excluded', async () => {
    process.env.APPOINTMENT_DEV_MODE = 'true';
    const now = new Date('2026-04-14T08:00:00.000Z');
    mockPrisma.appointmentSchedule.findMany.mockResolvedValue([]);

    await getMissedAppointments({ workspaceId: 'workspace-1', now });

    const query = mockPrisma.appointmentSchedule.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      workspaceId: 'workspace-1',
      status: { in: ['CONFIRMED', 'RESCHEDULED'] },
      completedAt: null,
      cancelledAt: null,
    });
    expect(query.where.endAt.lte.toISOString()).toBe(new Date(now.getTime() - 60_000).toISOString());
  });

  it('does not mark completed appointments as missed', async () => {
    mockPrisma.appointmentSchedule.findUnique.mockResolvedValue(makeAppointment({ status: 'COMPLETED' }));

    const result = await markAppointmentMissed({ appointmentId: 'appointment-1' });

    expect(result).toBeNull();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('reschedule resets reminder flags and missed follow-up state', async () => {
    const existing = makeAppointment({
      id: 'appointment-1',
      status: 'MISSED',
      reminder24hSent: true,
      reminder1hSent: true,
      missedFollowUpSent: true,
      missedFollowUpSentAt: new Date('2026-04-14T10:05:00.000Z'),
      missedFollowUpLockedAt: new Date('2026-04-14T10:01:00.000Z'),
    });
    const nextScheduledAt = new Date('2026-04-15T09:00:00.000Z');
    const nextEndAt = new Date('2026-04-15T10:00:00.000Z');

    mockPrisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace-1',
      ownerId: 'owner-1',
      name: 'Workspace',
      subTier: 'STARTER',
      subStatus: 'ACTIVE',
    });
    mockPrisma.appointmentSchedule.findFirst.mockResolvedValue(existing);
    mockPrisma.agent.findFirst.mockResolvedValue(makeAgentConfig());
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-1',
      name: 'Test Customer',
      phoneNumber: '6281234567890',
      isBlocked: false,
      isArchived: false,
    });
    mockPrisma.appointmentSchedule.findMany.mockResolvedValue([]);
    mockTx.appointmentSchedule.findUnique.mockResolvedValue(makeAppointment({
      ...existing,
      status: 'RESCHEDULED',
      scheduledAt: nextScheduledAt,
      endAt: nextEndAt,
      reminder24hSent: false,
      reminder1hSent: false,
      missedFollowUpSent: false,
      missedFollowUpSentAt: null,
      missedFollowUpLockedAt: null,
    }));

    await rescheduleAppointment({
      ownerId: 'owner-1',
      appointmentId: existing.id,
      input: {
        workspaceId: 'workspace-1',
        scheduledAt: nextScheduledAt.toISOString(),
        endAt: nextEndAt.toISOString(),
        notes: 'rescheduled',
      },
      actionBy: 'owner-1',
    });

    expect(mockTx.appointmentSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: existing.id },
      data: expect.objectContaining({
        status: 'RESCHEDULED',
        reminder24hSent: false,
        reminder1hSent: false,
        missedFollowUpSent: false,
        missedFollowUpSentAt: null,
        missedFollowUpLockedAt: null,
      }),
    }));
  });

  it('claims and finalizes missed follow-up sending with persistent anti-duplicate flags', async () => {
    const existing = makeAppointment({
      id: 'appointment-1',
      status: 'MISSED',
      missedFollowUpSent: false,
    });

    mockPrisma.appointmentSchedule.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.appointmentSchedule.findUnique.mockResolvedValueOnce(existing);
    mockPrisma.appointmentSchedule.findUnique.mockResolvedValueOnce(existing);
    mockTx.appointmentSchedule.findUnique.mockResolvedValue(makeAppointment({
      ...existing,
      status: 'MISSED',
      missedFollowUpSent: true,
      missedFollowUpSentAt: new Date('2026-04-14T10:06:00.000Z'),
      missedFollowUpLockedAt: null,
    }));

    const claimed = await claimMissedFollowUp({ appointmentId: existing.id });
    const finalized = await markMissedFollowUpSent({ appointmentId: existing.id, actionBy: 'system' });

    expect(claimed?.id).toBe(existing.id);
    expect(mockPrisma.appointmentSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: existing.id,
        status: 'MISSED',
        missedFollowUpSent: false,
        missedFollowUpLockedAt: null,
      }),
      data: expect.objectContaining({
        missedFollowUpLockedAt: expect.any(Date),
      }),
    }));
    expect(mockTx.appointmentSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        missedFollowUpSent: true,
        missedFollowUpSentAt: expect.any(Date),
        missedFollowUpLockedAt: null,
      }),
    }));
    expect(mockTx.appointmentActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'MISSED_FOLLOWUP_SENT' }),
    }));
    expect(finalized?.missedFollowUpSent).toBe(true);
  });

  it('routes missed follow-up through the appointment agent channel in multi-agent channel setups', async () => {
    const appointment = makeAppointment({
      id: 'appointment-1',
      status: 'MISSED',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
    });

    mockPrisma.appointmentSchedule.findUnique.mockResolvedValue(appointment);
    mockPrisma.agent.findUnique.mockResolvedValue(makeAgentConfig({ id: 'agent-1' }));
    mockPrisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      status: 'ACTIVE',
      channelId: 'channel-stale',
      channelType: 'WHATSAPP',
      channel: {
        id: 'channel-stale',
        status: 'DISCONNECTED',
        type: 'WHATSAPP',
      },
    });
    mockPrisma.channel.findFirst.mockResolvedValue({
      id: 'channel-whatsapp-agent-1',
      type: 'WHATSAPP',
      status: 'CONNECTED',
    });
    mockPrisma.conversation.update.mockResolvedValue({
      id: 'conversation-1',
      status: 'ACTIVE',
      channelId: 'channel-whatsapp-agent-1',
      channelType: 'WHATSAPP',
    });
    mockHandleOutbound.mockResolvedValue({ message: { id: 'message-1' } });

    await sendAppointmentMissedFollowUp({ appointmentId: appointment.id });

    expect(mockPrisma.channel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: 'agent-1',
        type: 'WHATSAPP',
      }),
    }));
    expect(mockHandleOutbound).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      phoneNumber: '6281234567890',
      conversationId: 'conversation-1',
      messageType: 'appointment_missed_follow_up',
    }));
  });

  it('auto-completes overdue appointments after the threshold and logs the transition', async () => {
    const existing = makeAppointment({ id: 'appointment-1', status: 'CONFIRMED' });

    mockPrisma.appointmentSchedule.findUnique.mockResolvedValue(existing);
    mockTx.appointmentSchedule.findUnique.mockResolvedValue(makeAppointment({
      ...existing,
      status: 'COMPLETED',
      completedAt: new Date('2026-04-14T10:30:00.000Z'),
    }));

    const result = await autoCompleteAppointment({ appointmentId: existing.id, actionBy: 'system' });

    expect(mockTx.appointmentSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      }),
    }));
    expect(mockTx.appointmentActivityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'AUTO_COMPLETED' }),
    }));
    expect(result?.status).toBe('COMPLETED');
  });

  it('respects appointment timezone when calculating today appointments outside Asia/Jakarta', async () => {
    const now = new Date('2026-04-14T03:30:00.000Z');
    mockPrisma.appointmentSchedule.findMany.mockResolvedValue([
      makeAppointment({
        id: 'new-york-same-day',
        timezone: 'America/New_York',
        scheduledAt: new Date('2026-04-14T03:00:00.000Z'),
      }),
      makeAppointment({
        id: 'new-york-next-day',
        timezone: 'America/New_York',
        scheduledAt: new Date('2026-04-14T05:30:00.000Z'),
      }),
    ]);

    const results = await getTodayAppointments({ workspaceId: 'workspace-1', now });

    expect(results.map((item) => item.id)).toEqual(['new-york-same-day']);
  });
});