import type OpenAI from "openai";

export function extractGeneratedImage(response: OpenAI.Responses.Response): string | null {
  const calls = response.output.filter(
    (item): item is OpenAI.Responses.ResponseOutputItem.ImageGenerationCall =>
      item.type === "image_generation_call" && item.status === "completed" && !!item.result,
  );
  return calls.at(-1)?.result ?? null;
}
