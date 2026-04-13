'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Pencil, Trash2, Loader2, AlertCircle, ToggleLeft, ToggleRight, Upload, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';

const TYPE_LABELS = { FAQ: 'FAQ', PRODUCT: 'Produk', INFO: 'Info', PAYMENT: 'Pembayaran', SCHEDULE: 'Jadwal' };
const TYPE_COLORS = { FAQ: 'text-blue-400', PRODUCT: 'text-green-400', INFO: 'text-slate-300', PAYMENT: 'text-yellow-400', SCHEDULE: 'text-purple-400' };
const KNOWLEDGE_CONTENT_MAX = 50000;
const SUPPORTED_IMPORT_TYPES = '.txt,.md,.csv,.json';

const EMPTY_FORM = { title: '', content: '', type: 'FAQ', referenceUrl: '' };

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca dokumen'));
    reader.readAsText(file, 'utf-8');
  });
}

function toTitleFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

export default function KnowledgePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMeta, setImportMeta] = useState(null);
  const fileInputRef = useRef(null);

  async function load(wsId) {
    try {
      const { data } = await api.get('/knowledge', { params: { workspaceId: wsId } });
      setItems(data.items ?? data.data ?? data ?? []);
    } catch {
      setError('Gagal memuat knowledge base');
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const { data: me } = await api.get('/auth/me');
        setWorkspaceId(me.workspace?.id);
        await load(me.workspace?.id);
      } catch {
        setError('Gagal memuat data');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSaveError('');
    setImportMeta(null);
    setOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({ title: item.title, content: item.content, type: item.type, referenceUrl: item.referenceUrl || '' });
    setSaveError('');
    setImportMeta(null);
    setOpen(true);
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setSaveError('');
    try {
      const content = (await readTextFile(file)).trim();
      if (!content) {
        setSaveError('Dokumen kosong atau tidak bisa dibaca');
        return;
      }
      if (content.length > KNOWLEDGE_CONTENT_MAX) {
        setSaveError(`Dokumen terlalu panjang. Maksimal ${KNOWLEDGE_CONTENT_MAX.toLocaleString('id-ID')} karakter.`);
        return;
      }

      setForm((current) => ({
        ...current,
        title: current.title || toTitleFromFilename(file.name),
        content,
      }));
      setImportMeta({ name: file.name, size: file.size, chars: content.length });
    } catch (err) {
      setSaveError(err.message || 'Gagal mengimpor dokumen');
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    if (!form.title || !form.content) {
      setSaveError('Judul dan konten tidak boleh kosong');
      return;
    }
    if (form.content.length > KNOWLEDGE_CONTENT_MAX) {
      setSaveError(`Konten terlalu panjang. Maksimal ${KNOWLEDGE_CONTENT_MAX.toLocaleString('id-ID')} karakter.`);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      if (editing) {
        await api.patch(`/knowledge/${editing.id}`, form);
      } else {
        await api.post('/knowledge', { ...form, workspaceId });
      }
      setOpen(false);
      await load(workspaceId);
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (item) => {
    try {
      await api.patch(`/knowledge/${item.id}`, { isActive: !item.isActive });
      await load(workspaceId);
    } catch {
      setError('Gagal mengubah status');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/knowledge/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load(workspaceId);
    } catch {
      setError('Gagal menghapus knowledge');
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
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Tambah Knowledge
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="h-12 w-12 text-slate-600 mb-4" />
            <p className="text-slate-400 font-medium">Belum ada knowledge</p>
            <p className="text-slate-500 text-sm mt-1">Tambahkan FAQ, info produk, atau jadwal untuk agent Anda</p>
            <Button className="mt-4" onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Tambah Knowledge
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className={`border-slate-800 bg-slate-900 ${!item.isActive ? 'opacity-50' : ''}`}>
              <CardContent className="flex items-start justify-between py-4 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${TYPE_COLORS[item.type] ?? 'text-slate-300'}`}>
                      {TYPE_LABELS[item.type] ?? item.type}
                    </span>
                    {!item.isActive && <Badge variant="secondary" className="text-xs">Nonaktif</Badge>}
                  </div>
                  <p className="font-medium text-white truncate">{item.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{item.content}</p>
                  {item.referenceUrl && (
                    <a
                      href={item.referenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-xs text-sky-400 hover:text-sky-300"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Payment link / referensi
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => handleToggle(item)}>
                    {item.isActive
                      ? <ToggleRight className="h-5 w-5 text-green-400" />
                      : <ToggleLeft className="h-5 w-5 text-slate-500" />
                    }
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                    <Pencil className="h-4 w-4 text-slate-400" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(item)}>
                    <Trash2 className="h-4 w-4 text-slate-400 hover:text-red-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog Add/Edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Knowledge' : 'Tambah Knowledge'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {saveError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Tipe</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Judul</Label>
              <Input
                placeholder="Contoh: Cara pemesanan"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="bg-slate-800 border-slate-700"
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Link / Link Referensi (opsional)</Label>
              <Input
                placeholder="Contoh: https://payment.link/checkout/abc123"
                value={form.referenceUrl}
                onChange={(e) => setForm((f) => ({ ...f, referenceUrl: e.target.value }))}
                className="bg-slate-800 border-slate-700"
              />
              <p className="text-xs text-slate-400">
                Isi dengan payment link universal, katalog, formulir checkout, atau link referensi lain yang boleh dibagikan bot ke customer.
              </p>
              {form.referenceUrl && (
                <a
                  href={form.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  Preview payment link / referensi
                </a>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Konten</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SUPPORTED_IMPORT_TYPES}
                    className="hidden"
                    onChange={handleImportFile}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleImportClick} disabled={importing}>
                    {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    Import Dokumen
                  </Button>
                </div>
              </div>
              <Textarea
                placeholder="Tulis informasi lengkap di sini..."
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                className="bg-slate-800 border-slate-700 min-h-[160px]"
              />
              <div className="flex items-start justify-between gap-3 text-xs text-slate-400">
                <div>
                  <p>Import cepat mendukung file teks: TXT, MD, CSV, JSON.</p>
                  <p>Untuk dokumen sangat panjang, lebih aman pecah menjadi beberapa knowledge item.</p>
                  {importMeta && <p className="text-slate-300 mt-1">Dokumen terakhir: {importMeta.name} ({importMeta.chars.toLocaleString('id-ID')} karakter)</p>}
                </div>
                <span className={form.content.length > KNOWLEDGE_CONTENT_MAX ? 'text-red-400' : 'text-slate-400'}>
                  {form.content.length.toLocaleString('id-ID')} / {KNOWLEDGE_CONTENT_MAX.toLocaleString('id-ID')}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Hapus */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Knowledge?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.title}</strong> akan dihapus permanen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
