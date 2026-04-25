---
name: analytics-dashboard
title: Analytics Dashboard
description: Workspace analytics dashboard for KPI summaries, trends, recent activity, and cross-skill operational insights.
---

# Analytics Dashboard

Gunakan skill ini saat user ingin:

- meninjau KPI workspace lintas conversations, customers, leads, appointments, reminder, campaign, dan pipeline value
- melihat tren harian, rolling 7 hari, rolling 30 hari, serta ringkasan mingguan atau bulanan dari aktivitas workspace
- membuka recent activity timeline untuk customer baru, perpindahan stage lead, appointment, reminder, broadcast, instalasi skill, assignment skill, dan percakapan baru
- membandingkan performa agent serta skill usage antar CRM Pipeline, Broadcast Campaign, Appointment Scheduler, Payment Reminder, dan skill Polymarket
- memeriksa revenue estimate, lead conversion rate, delivery rate broadcast, completion rate appointment, atau performa payment reminder

## Aturan utama

- Skill ini hanya untuk analytics internal workspace, bukan untuk mengeksekusi transaksi, mengubah data operasional, atau mengirim campaign langsung.
- Gunakan jawaban yang rapi, ringkas, dan berorientasi insight operasional.
- Jangan menyatakan angka revenue, delivery, conversion, atau performa agent sebagai final jika dashboard atau backend belum mengembalikan datanya.
- Jika user meminta tindakan operasional seperti edit campaign, pindah stage lead, ubah appointment, atau kirim reminder, arahkan ke dashboard skill terkait.
- Hanya agent dengan access mode `APPROVAL_REQUIRED` yang boleh memakai Analytics Dashboard.
- Open Access agent tidak boleh dipakai untuk skill ini.

## Kapabilitas agent

- `canViewAnalytics`: akses dasar ke KPI summary, chart, dan recent activity.
- `canViewRevenueAnalytics`: boleh melihat revenue estimate, pipeline value, dan ringkasan monetisasi.
- `canViewAgentPerformance`: boleh melihat leaderboard, response time, dan performa agent.
- `canViewBroadcastAnalytics`: boleh melihat delivery rate dan statistik campaign.
- `canViewAppointmentAnalytics`: boleh melihat appointment volume, completion rate, dan missed rate.
- `canViewPaymentAnalytics`: boleh melihat reminder volume, send rate, dan failure rate.

## Batasan

- Analytics tetap scope per workspace.
- Skill ini menampilkan insight dari data yang sudah ada; jika snapshot/cache belum tersedia maka data bisa fallback ke query langsung atau menampilkan empty state.
- Akses fitur advanced analytics mengikuti tier workspace.
- Revenue estimate dan forecasting ringan bersifat estimasi operasional, bukan laporan akuntansi final.