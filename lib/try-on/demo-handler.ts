import "server-only";

import { cookies } from "next/headers";
import {
  assertSameOrigin,
  genericErrorResponse,
  jsonNoStore,
  rateLimitedResponse,
} from "@/lib/api/security";
import { validatePersonPhotoBuffer } from "@/lib/try-on/sessions/person-validation";
import { bufferToDataUrl, generateTryOnImage } from "@/lib/try-on/generate";
import {
  DEMO_ACCESS_COOKIE,
  generateDemoSessionId,
} from "@/lib/try-on/sessions/tokens";
import {
  getClientIp,
  isDemoKillSwitchEnabled,
  limitDemoByCookie,
  limitDemoByIp,
  limitDemoGlobal,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_BYTES = 8 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return bufferToDataUrl(buffer, file.type || "application/octet-stream");
}

export async function handleDemoTryOn(request: Request) {
  if (isDemoKillSwitchEnabled()) {
    return genericErrorResponse("Demo try-on is temporarily unavailable.", 503);
  }

  if (!assertSameOrigin(request)) {
    return genericErrorResponse("Invalid request origin.", 403);
  }

  try {
    const ip = getClientIp(request);
    const [ipLimit, globalLimit] = await Promise.all([
      limitDemoByIp(ip),
      limitDemoGlobal(),
    ]);

    if (!ipLimit.success || !globalLimit.success) {
      return rateLimitedResponse();
    }
  } catch {
    return rateLimitedResponse();
  }

  const cookieStore = await cookies();
  let demoCookie = cookieStore.get(DEMO_ACCESS_COOKIE)?.value;

  if (!demoCookie) {
    demoCookie = generateDemoSessionId();
    cookieStore.set(DEMO_ACCESS_COOKIE, demoCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }

  try {
    const cookieLimit = await limitDemoByCookie(demoCookie);

    if (!cookieLimit.success) {
      return rateLimitedResponse();
    }
  } catch {
    return rateLimitedResponse();
  }

  if (!process.env.OPENAI_API_KEY) {
    return genericErrorResponse(
      "The try-on service is not configured yet. Add OPENAI_API_KEY to your environment.",
      500,
    );
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return genericErrorResponse("Invalid request.", 400);
  }

  const person = form.get("person");
  const item = form.get("item") ?? form.get("outfit");

  if (!(person instanceof File) || !(item instanceof File)) {
    return genericErrorResponse("Please provide both your photo and an item image.", 400);
  }

  for (const file of [person, item]) {
    if (file.size > MAX_BYTES) {
      return genericErrorResponse("Each image must be under 8MB.", 413);
    }
  }

  const personValidation = validatePersonPhotoBuffer(
    Buffer.from(await person.arrayBuffer()),
    person.type,
  );
  const itemValidation = validatePersonPhotoBuffer(
    Buffer.from(await item.arrayBuffer()),
    item.type,
  );

  if (!personValidation.ok) {
    return genericErrorResponse(personValidation.error.message, 400);
  }

  if (!itemValidation.ok) {
    return genericErrorResponse(itemValidation.error.message, 400);
  }

  const [personUrl, itemUrl] = await Promise.all([
    fileToDataUrl(person),
    fileToDataUrl(item),
  ]);

  const generation = await generateTryOnImage({ personDataUrl: personUrl, itemDataUrl: itemUrl });

  if (!generation.ok) {
    return genericErrorResponse(generation.message, 502);
  }

  return jsonNoStore({ image: `data:image/png;base64,${generation.imageBase64}` });
}
