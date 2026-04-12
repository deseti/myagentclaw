'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import GoogleAuthButton from '@/components/google-auth-button';
import { authenticateWithGoogle, login } from '@/lib/auth';

const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
});

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data) => {
    setError('');
    try {
      await login(data.email, data.password);
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Email atau password salah');
    }
  };

  const handleGoogleLogin = async (googlePayload) => {
    setError('');
    setGoogleSubmitting(true);
    try {
      await authenticateWithGoogle(googlePayload);
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login Google gagal.');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader>
        <CardTitle className="text-xl">Masuk ke Dashboard</CardTitle>
        <CardDescription>Masuk dengan email dan password atau akun Google</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

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
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                {...register('password')}
                className="bg-slate-800 border-slate-700 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || googleSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Masuk
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          <div className="h-px flex-1 bg-slate-800" />
          <span>Atau</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        <GoogleAuthButton text="continue_with" onCredential={handleGoogleLogin} disabled={googleSubmitting || isSubmitting} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-slate-400">
        Belum punya akun?&nbsp;
        <Link href="/register" className="text-primary hover:underline font-medium">
          Daftar sekarang
        </Link>
      </CardFooter>
    </Card>
  );
}
