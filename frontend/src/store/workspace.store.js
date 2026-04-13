import { create } from 'zustand';

export const useWorkspaceStore = create((set) => ({
  workspaceId: null,
  workspaceName: null,
  tier: null,
  subStatus: null,

  setWorkspace: (data) =>
    set({
      workspaceId: data.id,
      workspaceName: data.name,
      tier: data.subTier,
      subStatus: data.subStatus,
    }),

  clear: () =>
    set({ workspaceId: null, workspaceName: null, tier: null, subStatus: null }),
}));

export const useDashboardStore = create((set) => ({
  chatToday: 0,
  activeLeads: 0,
  needsAdmin: 0,
  quotaUsed: 0,
  quotaLimit: 0,

  setStats: (stats) => set(stats),
  incrementChatToday: () => set((s) => ({ chatToday: s.chatToday + 1 })),
  incrementNeedsAdmin: () => set((s) => ({ needsAdmin: s.needsAdmin + 1 })),
  decrementNeedsAdmin: () => set((s) => ({ needsAdmin: Math.max(0, s.needsAdmin - 1) })),
}));
