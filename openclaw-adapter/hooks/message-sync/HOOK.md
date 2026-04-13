---
name: message-sync
description: "Sinkronkan pesan inbound/outbound channel ke backend myagentclaw"
metadata:
  openclaw:
    emoji: "🔄"
    events: ["message:received", "message:sent"]
---

# Message Sync

Hook ini mengirim event pesan channel ke backend internal agar data percakapan,
metrik dashboard, dan quota tetap sinkron meskipun agent tidak memanggil tool save-message.
