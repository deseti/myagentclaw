'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import GoogleAuthButton from '@/components/google-auth-button';
import { authenticateWithGoogle, register as registerUser } from '@/lib/auth';

const registerSchema = z
  .object({
    workspaceName: z.string().min(2, 'Nama bisnis minimal 2 karakter'),
    name: z.string().min(2, 'Nama minimal 2 karakter'),
    email: z.string().email('Format email tidak valid'),
    password: z.string().min(8, 'Password minimal 8 karakter'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Password tidak cocok',
    path: ['confirmPassword'],
  });

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(registerSchema) });

  const workspaceName = watch('workspaceName');

  const onSubmit = async (data) => {
    setError('');
    try {
      await registerUser({
        name: data.name,
        workspaceName: data.workspaceName,
        email: data.email,
        password: data.password,
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Pendaftaran gagal. Coba lagi.');
    }
  };

  const handleGoogleRegister = async (googlePayload) => {
    setError('');
    setGoogleSubmitting(true);
    try {
      await authenticateWithGoogle({
        ...googlePayload,
        workspaceName,
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Pendaftaran dengan Google gagal.');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader>
        <CardTitle className="text-xl">Buat Akun Baru</CardTitle>
        <CardDescription>Daftar dengan form biasa atau langsung pakai akun Google</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="workspaceName">Nama Bisnis</Label>
            <Input
              id="workspaceName"
              placeholder="Toko Online Saya"
              {...register('workspaceName')}
              className="bg-slate-800 border-slate-700"
            />
            {errors.workspaceName && <p className="text-xs text-red-400">{errors.workspaceName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nama Anda</Label>
            <Input
              id="name"
              placeholder="Nama Lengkap"
              {...register('name')}
              className="bg-slate-800 border-slate-700"
            />
            {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="email@bisnis.com"
              {...register('email')}
              className="bg-slate-800 border-slate-700"
            />
            {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min. 6 karakter"
              {...register('password')}
              className="bg-slate-800 border-slate-700"
            />
            {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Ulangi password"
              {...register('confirmPassword')}
              className="bg-slate-800 border-slate-700"
            />
            {errors.confirmPassword && <p className="text-xs text-red-400">{errors.confirmPassword.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || googleSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Daftar Sekarang
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <div className="h-px flex-1 bg-slate-800" />
          <span>Atau</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        <GoogleAuthButton text="signup_with" onCredential={handleGoogleRegister} disabled={googleSubmitting || isSubmitting} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-slate-400">
        Sudah punya akun?&nbsp;
        <Link href="/login" className="text-primary hover:underline font-medium">
          Masuk di sini
        </Link>
      </CardFooter>
    </Card>
  );
}
