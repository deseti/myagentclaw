import { PrismaClient } from '@prisma/client';

// Singleton PrismaClient — satu instance untuk seluruh aplikasi
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

export default prisma;
