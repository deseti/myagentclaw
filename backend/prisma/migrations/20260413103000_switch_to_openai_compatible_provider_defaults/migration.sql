ALTER TABLE "agents"
  ALTER COLUMN "llm_provider" SET DEFAULT 'openai-compatible',
  ALTER COLUMN "llm_model" SET DEFAULT 'qwen/qwen3-32b';