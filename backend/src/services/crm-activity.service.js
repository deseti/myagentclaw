import prisma from '../lib/prisma.js';
import { serializeCrmPipelineActivity } from '../lib/crm-pipeline.js';
import { assertCrmPipelineAccess, serviceError } from './crm-pipeline.service.js';

const crmActivityInclude = {
  previousStage: true,
  newStage: true,
  createdByUser: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

export async function recordCrmActivityTx(tx, payload) {
  const createdAt = payload.createdAt || new Date();
  const activity = await tx.crmPipelineActivity.create({
    data: {
      workspaceId: payload.workspaceId,
      customerPipelineEntryId: payload.customerPipelineEntryId,
      type: payload.type,
      previousStageId: payload.previousStageId || null,
      newStageId: payload.newStageId || null,
      note: payload.note || null,
      metadataJson: payload.metadataJson || null,
      createdByUserId: payload.createdByUserId || null,
      createdAt,
    },
    include: crmActivityInclude,
  });

  if (payload.touchEntry !== false) {
    await tx.crmCustomerPipelineEntry.update({
      where: { id: payload.customerPipelineEntryId },
      data: {
        lastActivityAt: createdAt,
      },
    });
  }

  return activity;
}

export async function listCrmActivities({ ownerId, workspaceId, customerPipelineEntryId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });

  const entry = await prisma.crmCustomerPipelineEntry.findFirst({
    where: {
      id: customerPipelineEntryId,
      workspaceId,
      workspace: { ownerId },
    },
    select: { id: true },
  });

  if (!entry) {
    throw serviceError(404, 'Lead pipeline tidak ditemukan');
  }

  const activities = await prisma.crmPipelineActivity.findMany({
    where: {
      workspaceId,
      customerPipelineEntryId,
    },
    orderBy: { createdAt: 'desc' },
    include: crmActivityInclude,
  });

  return {
    activities: activities.map(serializeCrmPipelineActivity),
  };
}

export const crmActivityService = {
  listCrmActivities,
  recordCrmActivityTx,
};