ALTER TABLE "agents"
ALTER COLUMN "llm_provider" SET DEFAULT 'openai-codex',
ALTER COLUMN "llm_model" SET DEFAULT 'openai-codex/gpt-5.4';