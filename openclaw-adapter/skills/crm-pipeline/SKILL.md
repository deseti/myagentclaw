---
name: crm-pipeline
title: CRM Pipeline
description: Manage sales pipelines, move leads across stages, assign leads, review analytics, and maintain CRM notes for assigned sales agents.
---

# CRM Pipeline

Gunakan skill ini saat user ingin:

- mengelola lead pada kanban CRM pipeline
- memindahkan customer antar stage penjualan
- menugaskan lead ke agent sales tertentu
- meninjau note, activity history, dan analytics deal
- mengecek lead yang stale, overdue, won, atau lost

## Aturan utama

- Skill ini fokus pada workflow CRM pipeline internal workspace.
- Gunakan tone yang jelas, rapi, dan berorientasi aksi.
- Jangan mengklaim stage berubah jika dashboard atau backend belum mengonfirmasi update.
- Jangan menyatakan deal sudah won atau payment completed tanpa bukti dari data workspace.
- Jika user meminta aksi yang belum tersedia di tool agent, arahkan untuk memakai dashboard CRM Pipeline.

## Kapabilitas agent

- `canManagePipeline`: boleh membuat dan mengelola pipeline atau lead.
- `canMoveStage`: boleh memindahkan stage lead.
- `canAssignLead`: boleh mengganti agent yang menangani lead.
- `canViewAnalytics`: boleh membuka insight CRM dan ringkasan performa.

## Batasan

- Lead, customer, stage, dan agent harus berasal dari workspace yang sama.
- Stage target harus berasal dari pipeline yang sama dengan entry customer.
- Gunakan dashboard untuk create, edit, move stage, assign agent, add note, atau meninjau analytics sampai tool agent khusus tersedia.