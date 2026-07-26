/**
 * Local-only helper: send a generation event through the Inngest Dev Server.
 * Usage: node scripts/phase7-send-generation-event.mjs <sessionId> <brandId>
 */
process.env.INNGEST_DEV = process.env.INNGEST_DEV ?? "1";

const sessionId = process.argv[2];
const brandId = process.argv[3];

if (!sessionId || !brandId) {
  console.error("Usage: node scripts/phase7-send-generation-event.mjs <sessionId> <brandId>");
  process.exit(1);
}

const { Inngest } = await import("inngest");

const client = new Inngest({
  id: "dekhlo",
  isDev: true,
});

const eventId = `try-on-generation:${sessionId}`;

const result = await client.send({
  name: "dekhlo/try-on.generation.requested",
  data: { sessionId, brandId },
  id: eventId,
});

console.log(JSON.stringify({ ok: true, eventId, ids: result.ids }));
