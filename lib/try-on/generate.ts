import "server-only";

import OpenAI from "openai";
import {
  TRY_ON_CHAT_MODEL,
  TRY_ON_IMAGE_QUALITY,
  TRY_ON_VISION_DETAIL,
} from "@/lib/try-on/config";
import { extractGeneratedImage } from "@/lib/try-on/extract-image";
import { TRY_ON_PROMPT } from "@/lib/try-on/prompt";

type ImageGenTool = OpenAI.Responses.Tool.ImageGeneration & {
  action?: "auto" | "generate" | "edit";
};

function isReasoningModel(model: string): boolean {
  return /^gpt-5|^o[134]/.test(model);
}

export type TryOnGenerationInput = {
  personDataUrl: string;
  itemDataUrl: string;
};

export type TryOnGenerationResult =
  | { ok: true; imageBase64: string }
  | { ok: false; message: string };

export async function generateTryOnImage(
  input: TryOnGenerationInput,
): Promise<TryOnGenerationResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      message: "The try-on service is not configured yet. Add OPENAI_API_KEY to your environment.",
    };
  }

  try {
    const client = new OpenAI();

    const response = await client.responses.create({
      model: TRY_ON_CHAT_MODEL,
      tool_choice: { type: "image_generation" },
      ...(isReasoningModel(TRY_ON_CHAT_MODEL)
        ? { reasoning: { effort: "low" as const } }
        : {}),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: TRY_ON_PROMPT },
            {
              type: "input_image",
              image_url: input.personDataUrl,
              detail: TRY_ON_VISION_DETAIL,
            },
            {
              type: "input_image",
              image_url: input.itemDataUrl,
              detail: TRY_ON_VISION_DETAIL,
            },
          ],
        },
      ],
      tools: [
        {
          type: "image_generation",
          action: "edit",
          quality: TRY_ON_IMAGE_QUALITY,
          size: "auto",
        } as ImageGenTool,
      ],
    });

    const b64 = extractGeneratedImage(response);

    if (!b64) {
      return {
        ok: false,
        message: "The model did not return an image. Please try again.",
      };
    }

    return { ok: true, imageBase64: b64 };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Try-on failed.";
    return { ok: false, message };
  }
}

export async function bufferToDataUrl(buffer: Buffer, mimeType: string): Promise<string> {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
