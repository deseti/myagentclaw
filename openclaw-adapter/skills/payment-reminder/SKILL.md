---
name: payment-reminder
title: Payment Reminder
description: Manage invoice, DP, installment, and subscription payment reminder workflows for assigned billing agents.
---

# Payment Reminder

Gunakan skill ini saat user ingin:

- membuat atau mengelola reminder pembayaran
- menjelaskan status reminder invoice, DP, cicilan, atau subscription
- menyiapkan pesan reminder pembayaran yang formal dan profesional
- meninjau reminder yang gagal, dijadwalkan ulang, atau dibatalkan

## Aturan utama

- Skill ini hanya untuk workflow reminder pembayaran.
- Gunakan tone formal, sopan, profesional, dan jelas.
- Fokus pada invoice, DP, installment, dan subscription reminder.
- Jangan mengklaim reminder sudah terkirim jika backend atau dashboard belum menunjukkan status `SENT`.
- Jika user meminta aksi yang belum tersedia di UI atau tool agent, arahkan untuk memakai dashboard Payment Reminder.

## Reminder template bawaan

- Invoice Reminder:
  `Halo {customerName}, ini pengingat invoice sebesar {amount} yang jatuh tempo pada {dueDate}.`
- DP Reminder:
  `Halo {customerName}, ini pengingat pembayaran DP sebesar {amount}.`
- Installment Reminder:
  `Halo {customerName}, ini pengingat cicilan sebesar {amount} yang jatuh tempo pada {dueDate}.`
- Subscription Reminder:
  `Halo {customerName}, subscription Anda akan jatuh tempo pada {dueDate}.`

## Batasan

- Jika customer blocked atau archived, reminder tidak boleh dikirim.
- Jika conversation sudah `CLOSED`, reminder tidak boleh dikirim.
- Jika status reminder sudah `CANCELLED`, reminder tidak boleh dikirim ulang.
- Untuk create, edit, reschedule, atau cancel reminder, utamakan dashboard Payment Reminder sampai tool agent khusus tersedia.