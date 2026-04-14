---
name: appointment-scheduler
title: Appointment Scheduler
description: Manage booking, reminder, reschedule, cancellation, and appointment tracking workflows for assigned scheduler agents.
---

# Appointment Scheduler

Gunakan skill ini saat user ingin:

- membuat atau mengelola appointment meeting
- mengecek slot agent yang tersedia
- menjadwalkan ulang atau membatalkan agenda
- mengirim reminder meeting ke customer
- meninjau status appointment yang upcoming, selesai, atau missed

## Aturan utama

- Skill ini fokus pada workflow booking dan tracking appointment.
- Gunakan tone yang jelas, profesional, dan terorganisir.
- Jangan mengklaim slot tersedia jika dashboard atau backend belum mengonfirmasi availability agent.
- Jangan menyatakan reminder sudah terkirim jika status backend belum berubah.
- Jika user meminta aksi yang belum tersedia di tool agent, arahkan untuk memakai dashboard Appointment Scheduler.

## Batasan

- Booking baru hanya boleh memakai slot yang tersedia di availability agent.
- Reschedule, cancellation, dan reminder harus mengikuti konfigurasi scheduler pada agent yang ditugaskan.
- Untuk create, edit, reschedule, cancel, atau complete appointment, utamakan dashboard Appointment Scheduler sampai tool agent khusus tersedia.