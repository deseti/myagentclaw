import prisma from '../lib/prisma.js';
import { serializeCrmPipelineStage } from '../lib/crm-pipeline.js';
import { assertCrmPipelineAccess, serviceError } from './crm-pipeline.service.js';

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeProbability(value, fallback = 0) {
  const numericValue = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, numericValue));
}

async function loadPipelineOrThrow(workspaceId, pipelineId) {
  const pipeline = await prisma.crmPipeline.findFirst({
    where: {
      id: pipelineId,
      workspaceId,
    },
    include: {
      stages: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!pipeline) {
    throw serviceError(404, 'Pipeline CRM tidak ditemukan');
  }

  return pipeline;
}

async function loadStageOrThrow(workspaceId, stageId) {
  const stage = await prisma.crmPipelineStage.findFirst({
    where: {
      id: stageId,
      pipeline: { workspaceId },
    },
  });

  if (!stage) {
    throw serviceError(404, 'Stage CRM tidak ditemukan');
  }

  return stage;
}

async function resequenceStagesTx(tx, pipelineId, stageIds) {
  await Promise.all(stageIds.map((stageId, index) => tx.crmPipelineStage.update({
    where: { id: stageId },
    data: { position: index + 1 },
  })));
}

export async function listCrmStages({ ownerId, workspaceId, pipelineId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const pipeline = await loadPipelineOrThrow(workspaceId, pipelineId);

  return {
    stages: pipeline.stages.map(serializeCrmPipelineStage),
  };
}

export async function createCrmStage({ ownerId, workspaceId, pipelineId, payload = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const pipeline = await loadPipelineOrThrow(workspaceId, pipelineId);
  const trimmedName = String(payload.name || '').trim();

  if (!trimmedName) {
    throw serviceError(400, 'Nama stage wajib diisi.', {
      name: ['Nama stage wajib diisi.'],
    });
  }

  const targetPosition = Math.max(1, Math.min(
    Number.parseInt(String(payload.position ?? pipeline.stages.length + 1), 10) || pipeline.stages.length + 1,
    pipeline.stages.length + 1,
  ));

  const createdStage = await prisma.$transaction(async (tx) => {
    const currentStages = await tx.crmPipelineStage.findMany({
      where: { pipelineId },
      orderBy: { position: 'asc' },
    });

    const orderedStageIds = currentStages.map((stage) => stage.id);
    orderedStageIds.splice(targetPosition - 1, 0, '__new_stage__');

    if (payload.isClosedWon) {
      await tx.crmPipelineStage.updateMany({
        where: { pipelineId, isClosedWon: true },
        data: { isClosedWon: false },
      });
    }

    if (payload.isClosedLost) {
      await tx.crmPipelineStage.updateMany({
        where: { pipelineId, isClosedLost: true },
        data: { isClosedLost: false },
      });
    }

    const stage = await tx.crmPipelineStage.create({
      data: {
        pipelineId,
        name: trimmedName,
        description: normalizeOptionalText(payload.description),
        color: normalizeOptionalText(payload.color),
        position: 9999,
        probabilityPercent: normalizeProbability(payload.probabilityPercent, 0),
        isDefault: Boolean(payload.isDefault),
        isClosedWon: Boolean(payload.isClosedWon),
        isClosedLost: Boolean(payload.isClosedLost),
      },
    });

    const nextOrderedStageIds = orderedStageIds.map((stageId) => (stageId === '__new_stage__' ? stage.id : stageId));
    await resequenceStagesTx(tx, pipelineId, nextOrderedStageIds);

    return tx.crmPipelineStage.findUnique({ where: { id: stage.id } });
  });

  return {
    stage: serializeCrmPipelineStage(createdStage),
  };
}

export async function updateCrmStage({ ownerId, workspaceId, stageId, payload = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const stage = await loadStageOrThrow(workspaceId, stageId);

  const updatedStage = await prisma.$transaction(async (tx) => {
    if (payload.isClosedWon === true) {
      await tx.crmPipelineStage.updateMany({
        where: { pipelineId: stage.pipelineId, isClosedWon: true, id: { not: stage.id } },
        data: { isClosedWon: false },
      });
    }

    if (payload.isClosedLost === true) {
      await tx.crmPipelineStage.updateMany({
        where: { pipelineId: stage.pipelineId, isClosedLost: true, id: { not: stage.id } },
        data: { isClosedLost: false },
      });
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'position')) {
      const currentStages = await tx.crmPipelineStage.findMany({
        where: { pipelineId: stage.pipelineId },
        orderBy: { position: 'asc' },
      });
      const orderedStageIds = currentStages.map((item) => item.id).filter((itemId) => itemId !== stage.id);
      const targetPosition = Math.max(1, Math.min(
        Number.parseInt(String(payload.position), 10) || stage.position,
        orderedStageIds.length + 1,
      ));
      orderedStageIds.splice(targetPosition - 1, 0, stage.id);
      await resequenceStagesTx(tx, stage.pipelineId, orderedStageIds);
    }

    return tx.crmPipelineStage.update({
      where: { id: stage.id },
      data: {
        ...(Object.prototype.hasOwnProperty.call(payload, 'name')
          ? { name: String(payload.name || '').trim() || stage.name }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'description')
          ? { description: normalizeOptionalText(payload.description) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'color')
          ? { color: normalizeOptionalText(payload.color) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'probabilityPercent')
          ? { probabilityPercent: normalizeProbability(payload.probabilityPercent, stage.probabilityPercent) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'isDefault')
          ? { isDefault: Boolean(payload.isDefault) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'isClosedWon')
          ? { isClosedWon: Boolean(payload.isClosedWon) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'isClosedLost')
          ? { isClosedLost: Boolean(payload.isClosedLost) }
          : {}),
      },
    });
  });

  return {
    stage: serializeCrmPipelineStage(updatedStage),
  };
}

export async function deleteCrmStage({ ownerId, workspaceId, stageId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const stage = await loadStageOrThrow(workspaceId, stageId);

  const [pipelineStageCount, entryCount] = await Promise.all([
    prisma.crmPipelineStage.count({ where: { pipelineId: stage.pipelineId } }),
    prisma.crmCustomerPipelineEntry.count({ where: { stageId: stage.id } }),
  ]);

  if (pipelineStageCount <= 1) {
    throw serviceError(409, 'Pipeline harus memiliki minimal satu stage.');
  }

  if (entryCount > 0) {
    throw serviceError(409, 'Stage yang masih dipakai lead tidak bisa dihapus.', {
      stageId: stage.id,
      entryCount,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.crmPipelineStage.delete({ where: { id: stage.id } });
    const remainingStages = await tx.crmPipelineStage.findMany({
      where: { pipelineId: stage.pipelineId },
      orderBy: { position: 'asc' },
    });
    await resequenceStagesTx(tx, stage.pipelineId, remainingStages.map((item) => item.id));
  });

  return {
    deletedStage: serializeCrmPipelineStage(stage),
  };
}

export async function reorderCrmStages({ ownerId, workspaceId, pipelineId, stageIds = [] }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const pipeline = await loadPipelineOrThrow(workspaceId, pipelineId);
  const normalizedStageIds = [...new Set((stageIds || []).filter(Boolean))];

  if (normalizedStageIds.length !== pipeline.stages.length) {
    throw serviceError(400, 'Daftar stage untuk reorder tidak lengkap.');
  }

  const currentStageIds = new Set(pipeline.stages.map((stage) => stage.id));
  const isValidOrder = normalizedStageIds.every((stageId) => currentStageIds.has(stageId));
  if (!isValidOrder) {
    throw serviceError(400, 'Stage reorder harus berasal dari pipeline yang sama.');
  }

  await prisma.$transaction(async (tx) => {
    await resequenceStagesTx(tx, pipelineId, normalizedStageIds);
  });

  const reorderedStages = await prisma.crmPipelineStage.findMany({
    where: { pipelineId },
    orderBy: { position: 'asc' },
  });

  return {
    stages: reorderedStages.map(serializeCrmPipelineStage),
  };
}

export const crmStageService = {
  createCrmStage,
  deleteCrmStage,
  listCrmStages,
  reorderCrmStages,
  updateCrmStage,
};