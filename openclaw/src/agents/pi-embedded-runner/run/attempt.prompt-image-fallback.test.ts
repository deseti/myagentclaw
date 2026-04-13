import { describe, expect, it, vi } from "vitest";

const modelFallbackMocks = vi.hoisted(() => ({
  runWithImageModelFallback: vi.fn(),
}));

const imageRuntimeMocks = vi.hoisted(() => ({
  describeImagesWithModel: vi.fn(),
}));

vi.mock("../../model-fallback.js", () => modelFallbackMocks);
vi.mock("../../../media-understanding/image.js", () => imageRuntimeMocks);

import {
  appendPromptImageDescription,
  buildPromptWithImageDescriptions,
  canDescribePromptImages,
  shouldUsePromptImageDescriptionFallback,
} from "./attempt.prompt-image-fallback.js";

describe("attempt prompt image fallback", () => {
  it("uses the configured image model for text-only models", async () => {
    modelFallbackMocks.runWithImageModelFallback.mockImplementation(async (params) => {
      const runResult = await params.run("openai", "meta/llama-3.2-11b-vision-instruct");
      return {
        result: runResult,
        provider: "openai",
        model: "meta/llama-3.2-11b-vision-instruct",
        attempts: [],
      };
    });
    imageRuntimeMocks.describeImagesWithModel.mockResolvedValue({
      text: "A QR code on a white background.",
      model: "meta/llama-3.2-11b-vision-instruct",
    });

    const result = await buildPromptWithImageDescriptions({
      cfg: {
        agents: {
          defaults: {
            imageModel: "openai/meta/llama-3.2-11b-vision-instruct",
          },
        },
      },
      agentDir: "/tmp/agent",
      model: {
        provider: "openai",
        id: "minimaxai/minimax-m2.7",
        input: ["text"],
      },
      prompt: "Apa isi gambar ini?",
      images: [{ type: "image", data: Buffer.from("image").toString("base64"), mimeType: "image/png" }],
    });

    expect(modelFallbackMocks.runWithImageModelFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          agents: expect.objectContaining({
            defaults: expect.objectContaining({
              imageModel: "openai/meta/llama-3.2-11b-vision-instruct",
            }),
          }),
        }),
        modelOverride: undefined,
      }),
    );
    expect(result.prompt).toContain("[Attached image context]");
    expect(result.prompt).toContain("A QR code on a white background.");
  });

  it("prefers fallback for custom openai-compatible vision endpoints", () => {
    expect(
      shouldUsePromptImageDescriptionFallback({
        cfg: undefined,
        model: {
          provider: "openai",
          baseUrl: "https://integrate.api.nvidia.com/v1",
          input: ["text", "image"],
        },
        hasImages: true,
      }),
    ).toBe(true);
    expect(
      shouldUsePromptImageDescriptionFallback({
        cfg: undefined,
        model: {
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          input: ["text", "image"],
        },
        hasImages: true,
      }),
    ).toBe(false);
  });

  it("detects when prompt images can be described without native vision", () => {
    expect(
      canDescribePromptImages({
        cfg: {
          agents: { defaults: { imageModel: "openai/meta/llama-3.2-11b-vision-instruct" } },
        },
        model: { input: ["text"] },
      }),
    ).toBe(true);
    expect(canDescribePromptImages({ cfg: undefined, model: { input: ["text"] } })).toBe(false);
  });

  it("appends image context as a separate prompt section", () => {
    expect(appendPromptImageDescription("Hello", "Image details")).toBe(
      "Hello\n\n[Attached image context]\nImage details",
    );
  });
});