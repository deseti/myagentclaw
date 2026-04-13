// backend/prisma/seed.js
// Seed data demo: 1 owner, 1 workspace, 1 agent, subscription aktif

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Owner
  const passwordHash = await bcrypt.hash('demo123', 10)
  const owner = await prisma.owner.upsert({
    where: { email: 'demo@myagentclaw.com' },
    update: {},
    create: {
      name: 'Demo Owner',
      email: 'demo@myagentclaw.com',
      passwordHash,
      phone: '628123456789',
    },
  })
  console.log('✅ Owner:', owner.email)

  // 2. Workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: 'ws_demo_001' },
    update: {},
    create: {
      id: 'ws_demo_001',
      ownerId: owner.id,
      name: 'Toko Demo',
      businessType: 'reseller',
      subTier: 'STARTER',
      subStatus: 'ACTIVE',
    },
  })
  console.log('✅ Workspace:', workspace.name)

  // 3. Agent
  const agent = await prisma.agent.upsert({
    where: { id: 'agent_demo_001' },
    update: {},
    create: {
      id: 'agent_demo_001',
      workspaceId: workspace.id,
      name: 'Agen Sales Demo',
      persona: 'Asisten penjualan yang ramah dan helpful',
      tone: 'santai',
      goal: 'Membantu customer mendapatkan informasi produk dan melakukan pembelian',
      llmProvider: 'openai',
      llmModel: 'gpt-4o-mini',
      status: 'ACTIVE',
    },
  })
  console.log('✅ Agent:', agent.name)

  // 4. Knowledge Base (3 items)
  const knowledgeItems = [
    {
      id: 'kb_demo_001',
      workspaceId: workspace.id,
      type: 'FAQ',
      title: 'Apa saja produk yang tersedia?',
      content: 'Kami menjual produk A (Rp50.000), produk B (Rp75.000), dan produk C (Rp100.000). Semua tersedia stok.',
      isActive: true,
    },
    {
      id: 'kb_demo_002',
      workspaceId: workspace.id,
      type: 'PRODUCT',
      title: 'Produk A',
      content: 'Harga Rp50.000, tersedia stok. Warna: merah, biru, hijau. Pengiriman 1-3 hari kerja.',
      isActive: true,
    },
    {
      id: 'kb_demo_003',
      workspaceId: workspace.id,
      type: 'SCHEDULE',
      title: 'Jam operasional',
      content: 'Senin-Sabtu 08.00-17.00 WIB. Minggu & hari libur nasional tutup.',
      isActive: true,
    },
  ]

  for (const item of knowledgeItems) {
    await prisma.knowledgeBase.upsert({
      where: { id: item.id },
      update: {},
      create: item,
    })
  }
  console.log('✅ Knowledge Base: 3 items')

  // 5. Subscription (STARTER, active, expire 30 hari dari sekarang)
  const expireDate = new Date()
  expireDate.setDate(expireDate.getDate() + 30)

  await prisma.subscription.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      tier: 'STARTER',
      status: 'ACTIVE',
      quotaLimit: 1500,
      startDate: new Date(),
      expireDate,
      autoRenew: true,
    },
  })
  console.log('✅ Subscription: STARTER, 1500 quota, expire 30 hari')

  // 6. Quota Usage (bulan berjalan)
  const now = new Date()
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  await prisma.quotaUsage.upsert({
    where: {
      workspaceId_monthYear: {
        workspaceId: workspace.id,
        monthYear,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      monthYear,
      usedMessages: 0,
      limitMessages: 1500,
    },
  })
  console.log(`✅ Quota Usage: ${monthYear}, 0/1500 used`)

  console.log('\n🎉 Seed selesai!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Login demo:')
  console.log('  Email   : demo@myagentclaw.com')
  console.log('  Password: demo123')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => {
    console.error('❌ Seed gagal:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
