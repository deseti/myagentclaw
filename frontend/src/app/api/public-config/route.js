import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}