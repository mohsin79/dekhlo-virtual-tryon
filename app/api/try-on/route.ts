import OpenAI, { toFile } from "openai";

// The try-on generation runs on the Node runtime (needs the OpenAI SDK
// + file handling). It is intentionally not edge.
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const MAX_BYTES = 8 * 1024 * 1024; // 8MB per image

const PROMPT = [
  "Create a realistic virtual try-on image.",
  "The FIRST image is a photo of a person. The SECOND image is a clothing item (a garment, possibly worn by a model).",
  "Show the SAME person from the first image now wearing the outfit from the second image.",
  "Preserve the person's face, body shape, skin tone, hair and pose. Replace only their clothing with the provided outfit.",
  "Keep the garment's design, colour, pattern and details faithful. Full-length, natural lighting, photorealistic.",
  "This is a STYLE preview, not a guaranteed physical fit — prioritise a believable, flattering look over exact tailoring.",
].join(" ");

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
  const outfit = form.get("outfit");

  if (!(person instanceof File) || !(outfit instanceof File)) {
    return Response.json({ error: "Please provide both your photo and an outfit image." }, { status: 400 });
  }
  for (const f of [person, outfit]) {
    if (!f.type.startsWith("image/")) {
      return Response.json({ error: "Both uploads must be images." }, { status: 400 });
    }
    if (f.size > MAX_BYTES) {
      return Response.json({ error: "Each image must be under 8MB." }, { status: 413 });
    }
  }

  try {
    const client = new OpenAI();
    const images = await Promise.all([
      toFile(Buffer.from(await person.arrayBuffer()), "person.png", { type: person.type }),
      toFile(Buffer.from(await outfit.arrayBuffer()), "outfit.png", { type: outfit.type }),
    ]);

    const result = await client.images.edit({
      model: MODEL,
      image: images,
      prompt: PROMPT,
      size: "1024x1536",
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) {
      return Response.json({ error: "The model did not return an image. Please try again." }, { status: 502 });
    }

    return Response.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Try-on failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
