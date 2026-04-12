'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Bot, ToggleLeft, ToggleRight, Pencil, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import api from '@/lib/api';

const TIER_LIMITS = { FREE: 1, STARTER: 2, GROWTH: 5 };

function resolveAssignedSkills(agent) {
  const configSkills = Array.isArray(agent?.configJson?.assignedSkills)
    ? agent.configJson.assignedSkills
    : [];

  if (configSkills.length > 0) {
    return [...new Set(configSkills.map((skill) => String(skill || '').trim()).filter(Boolean))];
  }

  return agent?.openclawSkill ? [agent.openclawSkill] : [];
}

function resolveSharedWorkspaceAccess(agent) {
  const normalized = String(agent?.configJson?.sharedWorkspaceAccess || '').trim().toLowerCase();
  return ['none', 'ro', 'rw'].includes(normalized) ? normalized : 'none';
}

function getAccessModeMeta(accessMode) {
  return accessMode === 'APPROVAL_REQUIRED'
    ? { label: 'Approval Required', variant: 'warning' }
    : { label: 'Open Access', variant: 'success' };
}

export default function AgentsPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState('FREE');
  const [workspaceId, setWorkspaceId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data: me } = await api.get('/auth/me');
      setWorkspaceId(me.workspace?.id);
      setTier(me.workspace?.subTier || 'FREE');

      if (me.workspace?.id) {
        const { data } = await api.get('/agents', { params: { workspaceId: me.workspace.id } });
        setAgents(data.agents ?? []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat data agent');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const limit = TIER_LIMITS[tier] ?? 1;
  const canCreate = agents.length < limit;
  const canUseSkills = tier !== 'FREE';

  const handleToggle = async (agent) => {
    try {
      const newStatus = agent.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api.patch(`/agents/${agent.id}/toggle`, { status: newStatus });
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, status: newStatus } : a)));
    } catch {
      setError('Gagal mengubah status agent');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/agents/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menonaktifkan agent');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent AI</h1>
          <p className="text-slate-400 text-sm mt-1">
            {agents.length} / {limit} agent (Paket {tier})
          </p>
        </div>
        <Button asChild={canCreate} disabled={!canCreate}>
          {canCreate ? (
            <Link href="/dashboard/agents/new">
              <Plus className="mr-2 h-4 w-4" />
              Buat Agent Baru
            </Link>
          ) : (
            <span>
              <Plus className="mr-2 h-4 w-4" />
              Buat Agent Baru
            </span>
          )}
        </Button>
      </div>

      <Alert>
        <AlertDescription>
          Tombol hapus sekarang menjalankan mode aman: agent hanya dinonaktifkan. Saat agent nonaktif, customer tidak bisa chat, tetapi channel dan histori tetap tersimpan.
        </AlertDescription>
      </Alert>

      {!canCreate && (
        <Alert variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Anda telah mencapai batas {limit} agent untuk paket {tier}. Upgrade paket untuk menambah lebih banyak agent.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {agents.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Bot className="h-10 w-10 text-slate-600" />
            <p className="text-slate-400">Belum ada agent. Buat agent pertama Anda!</p>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/dashboard/agents/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Buat Agent
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => {
            const assignedSkills = resolveAssignedSkills(agent);
            const sharedWorkspaceAccess = resolveSharedWorkspaceAccess(agent);
            const accessModeMeta = getAccessModeMeta(agent.accessMode);

            return (
            <Card key={agent.id} className="border-slate-800 bg-slate-900">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <Bot className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{agent.name}</p>
                  <p className="text-xs text-slate-400 truncate">{agent.persona?.slice(0, 60) || 'Tidak ada persona'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={accessModeMeta.variant}>{accessModeMeta.label}</Badge>
                    {agent.accessMode === 'APPROVAL_REQUIRED' && agent.approvalCode && (
                      <Badge variant="outline">Code: {agent.approvalCode}</Badge>
                    )}
                  </div>
                  {canUseSkills && assignedSkills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {assignedSkills.map((skill) => (
                        <Badge key={`${agent.id}-${skill}`} variant="outline">Skill: {skill}</Badge>
                      ))}
                    </div>
                  )}
                  {tier !== 'FREE' && sharedWorkspaceAccess !== 'none' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        Shared: {sharedWorkspaceAccess === 'ro' ? 'Read-only' : 'Read-write'}
                      </Badge>
                    </div>
                  )}
                </div>
                <Badge variant={agent.status === 'ACTIVE' ? 'success' : 'secondary'}>
                  {agent.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                </Badge>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggle(agent)} title="Toggle status" className="text-slate-400 hover:text-white">
                    {agent.status === 'ACTIVE' ? (
                      <ToggleRight className="h-6 w-6 text-blue-400" />
                    ) : (
                      <ToggleLeft className="h-6 w-6" />
                    )}
                  </button>
                  <Button variant="ghost" size="icon" asChild>
                    <Link href={`/dashboard/agents/${agent.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(agent)}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle>Nonaktifkan Agent</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.name}</strong> akan dinonaktifkan. Customer tidak bisa chat selama agent nonaktif, tetapi channel dan histori percakapan tetap disimpan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Nonaktifkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
