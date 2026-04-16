---
name: broadcast-campaign
title: Broadcast Campaign
description: Manage broadcast campaign workflows for assigned sender agents, including audience filtering, scheduling, delivery tracking, and analytics.
---

# Broadcast Campaign

Gunakan skill ini saat user ingin:

- membuat atau mengelola campaign broadcast ke customer
- memfilter audience berdasarkan CRM stage, tag, status, channel, atau aktivitas terakhir
- menjadwalkan pengiriman broadcast ke batch audience
- memantau status pengiriman, delivery log, dan recipient yang gagal
- meninjau analytics campaign: delivery rate, channel terpakai, dan top performing campaign
- menjadwalkan ulang recipient yang gagal (retry failed)
- membatalkan atau menghapus campaign yang belum atau sedang berjalan

## Aturan utama

- Skill ini hanya untuk workflow broadcast campaign internal workspace.
- Gunakan tone yang jelas, sopan, informatif, dan berorientasi aksi.
- Jangan mengklaim campaign sudah terkirim jika backend atau dashboard belum menunjukkan status `SENT` atau `DELIVERED` pada recipient log.
- Jangan menyatakan audience sudah diverifikasi jika preview audience belum dijalankan.
- Jika user meminta aksi yang belum tersedia di UI atau tool agent, arahkan untuk memakai dashboard Broadcast Campaign.
- Hanya agent dengan access mode `APPROVAL_REQUIRED` yang boleh digunakan untuk campaign ini.
- Open Access agent tidak boleh digunakan sebagai sender campaign.

## Kapabilitas agent

- `canUseBroadcast`: akses dasar Broadcast Campaign.
- `canCreateCampaign`: boleh membuat campaign baru.
- `canEditCampaign`: boleh mengedit campaign draft atau scheduled.
- `canDeleteCampaign`: boleh menghapus campaign yang belum running.
- `canScheduleCampaign`: boleh menjadwalkan waktu kirim campaign.
- `canViewCampaignAnalytics`: boleh melihat analytics delivery, channel, dan agent.

## Audience filter yang tersedia

- `CRM_STAGE`: filter customer berdasarkan stage pipeline CRM.
- `CUSTOMER_TAG`: filter berdasarkan tag yang dimiliki customer.
- `CUSTOMER_STATUS`: filter berdasarkan status lifecycle customer (ACTIVE, PENDING, ARCHIVED, BLOCKED).
- `ASSIGNED_AGENT`: filter berdasarkan agent yang menangani customer.
- `CHANNEL_TYPE`: filter berdasarkan jenis channel (WHATSAPP, TELEGRAM).
- `APPROVAL_STATUS`: filter berdasarkan status approval akses customer.
- `LAST_ACTIVITY`: filter berdasarkan aktivitas terakhir customer dalam rentang waktu tertentu.
- `SPECIFIC_CUSTOMER`: pilih customer secara langsung dari daftar workspace.

## Batasan

- Customer yang blocked atau archived tidak akan menjadi recipient campaign.
- Customer tanpa channel session yang sesuai dengan channel type campaign akan diskip oleh worker.
- Campaign hanya bisa diedit selama masih berstatus DRAFT atau SCHEDULED.
- Campaign yang sudah RUNNING, COMPLETED, FAILED, atau CANCELLED tidak bisa diedit.
- Untuk create, edit, preview audience, schedule, cancel, atau delete campaign, utamakan dashboard Broadcast Campaign sampai tool agent khusus tersedia.
- Tier workspace menentukan batas maksimal campaign aktif dan audience per campaign.
- Advanced analytics (most used channel, top performing agent, top campaign) hanya tersedia untuk workspace tier Pro.
