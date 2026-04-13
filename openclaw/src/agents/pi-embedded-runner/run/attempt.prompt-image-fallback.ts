import type { Api, ImageContent, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../../config/model-input.js";
import { describeImagesWithModel } from "../../../media-understanding/image.js";
import { runWithImageModelFallback } from "../../model-fallback.js";

const DEFAULT_PROMPT_IMAGE_DESCRIPTION =
  "Describe the attached image for an AI assistant responding to the user's latest message. " +
  "Be concise and factual. Include visible text, objects, and details that matter for answering the user. " +
  "Do not speculate beyond what is visible.";

function hasConfiguredImageModel(cfg?: OpenClawConfig): boolean {
  const primary = resolveAgentModelPrimaryValue(cfg?.agents?.defaults?.imageModel)?.trim();
  if (primary) {
    return true;
  }
  return resolveAgentModelFallbackValues(cfg?.agents?.defaults?.imageModel).some((value) =>
    Boolean(value?.trim()),
  );
}

function isCustomOpenAiCompatibleEndpoint(model: Pick<Model<Api>, "provider" | "baseUrl">): boolean {
  if (model.provider !== "openai") {
    return false;
  }
  const baseUrl = model.baseUrl?.trim();
  if (!baseUrl) {
    return false;
  }
  return !/^https:\/\/api\.openai\.com(?:\/|$)/i.test(baseUrl);
}

export function canDescribePromptImages(params: {
  cfg?: OpenClawConfig;
  model: Pick<Model<Api>, "input">;
}): boolean {
  return Boolean(params.model.input?.includes("image") || hasConfiguredImageModel(params.cfg));
}

export function shouldUsePromptImageDescriptionFallback(params: {
  cfg?: OpenClawConfig;
  model: Pick<Model<Api>, "provider" | "baseUrl" | "input">;
  hasImages: boolean;
}): boolean {
  if (!params.hasImages) {
    return false;
  }
  if (!params.model.input?.includes("image")) {
    return hasConfiguredImageModel(params.cfg);
  }
  return isCustomOpenAiCompatibleEndpoint(params.model);
}

function buildPromptImageDescriptionPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return DEFAULT_PROMPT_IMAGE_DESCRIPTION;
  }
  return `${DEFAULT_PROMPT_IMAGE_DESCRIPTION}\n\nUser message:\n${trimmedPrompt}`;
}

export function appendPromptImageDescription(prompt: string, description: string): string {
  const trimmedPrompt = prompt.trim();
  const trimmedDescription = description.trim();
  if (!trimmedDescription) {
    return trimmedPrompt;
  }
  const section = `[Attached image context]\n${trimmedDescription}`;
  if (!trimmedPrompt) {
    return section;
  }
  return `${trimmedPrompt}\n\n${section}`;
}

export async function buildPromptWithImageDescriptions(params: {
  cfg?: OpenClawConfig;
  agentDir: string;
  model: Pick<Model<Api>, "provider" | "id" | "input">;
  prompt: string;
  images: ImageContent[];
  timeoutMs?: number;
}): Promise<{
  prompt: string;
  provider: string;
  model: string;
  attempts: Array<{ provider: string; model: string; error: string }>;
}> {
  const prompt = buildPromptImageDescriptionPrompt(params.prompt);
  const decodedImages = params.images.map((image, index) => ({
    buffer: Buffer.from(image.data, "base64"),
    fileName: `prompt-image-${index + 1}`,
    mime: image.mimeType,
  }));
  const modelOverride = params.model.input?.includes("image")
    ? `${params.model.provider}/${params.model.id}`
    : undefined;

  const result = await runWithImageModelFallback({
    cfg: params.cfg,
    modelOverride,
    run: async (provider, modelId) => {
      const described = await describeImagesWithModel({
        images: decodedImages,
        provider,
        model: modelId,
        prompt,
        maxTokens: 768,
        timeoutMs: params.timeoutMs ?? 30_000,
        agentDir: params.agentDir,
        cfg: params.cfg ?? {},
      });
      return {
        text: described.text.trim(),
        provider,
        model: described.model ?? modelId,
      };
    },
  });

  return {
    prompt: appendPromptImageDescription(params.prompt, result.result.text),
    provider: result.result.provider,
    model: result.result.model,
    attempts: result.attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error,
    })),
  };
}