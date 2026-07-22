import OpenAI from "openai";
import {
  TRY_ON_CHAT_MODEL,
  TRY_ON_IMAGE_QUALITY,
  TRY_ON_VISION_DETAIL,
} from "@/lib/try-on-config";
import { TRY_ON_PROMPT } from "@/lib/try-on-prompt";

// Chat + image_generation tool — same flow as ChatGPT, tuned for speed and cost.
export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BYTES = 8 * 1024 * 1024; // 8MB per image

type ImageGenTool = OpenAI.Responses.Tool.ImageGeneration & {
  action?: "auto" | "generate" | "edit";
};

async function fileToDataUrl(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buffer.toString("base64")}`;
}

function extractGeneratedImage(response: OpenAI.Responses.Response): string | null {
  const calls = response.output.filter(
    (item): item is OpenAI.Responses.ResponseOutputItem.ImageGenerationCall =>
      item.type === "image_generation_call" && item.status === "completed" && !!item.result,
  );
  return calls.at(-1)?.result ?? null;
}

function isReasoningModel(model: string): boolean {
  return /^gpt-5|^o[134]/.test(model);
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "The try-on service is not configured yet. Add OPENAI_API_KEY to your environment." },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const person = form.get("person");
  const item = form.get("item") ?? form.get("outfit");

  if (!(person instanceof File) || !(item instanceof File)) {
    return Response.json({ error: "Please provide both your photo and an item image." }, { status: 400 });
  }
  for (const f of [person, item]) {
    if (!f.type.startsWith("image/")) {
      return Response.json({ error: "Both uploads must be images." }, { status: 400 });
    }
    if (f.size > MAX_BYTES) {
      return Response.json({ error: "Each image must be under 8MB." }, { status: 413 });
    }
  }

  try {
    const client = new OpenAI();
    const [personUrl, itemUrl] = await Promise.all([
      fileToDataUrl(person),
      fileToDataUrl(item),
    ]);

    const response = await client.responses.create({
      model: TRY_ON_CHAT_MODEL,
      // Skip chat deliberation — go straight to image generation.
      tool_choice: { type: "image_generation" },
      // If using a reasoning model, keep effort low to save time and tokens.
      ...(isReasoningModel(TRY_ON_CHAT_MODEL)
        ? { reasoning: { effort: "low" as const } }
        : {}),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: TRY_ON_PROMPT },
            { type: "input_image", image_url: personUrl, detail: TRY_ON_VISION_DETAIL },
            { type: "input_image", image_url: itemUrl, detail: TRY_ON_VISION_DETAIL },
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
      return Response.json(
        { error: "The model did not return an image. Please try again." },
        { status: 502 },
      );
    }

    return Response.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Try-on failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
