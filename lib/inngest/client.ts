import "server-only";

import { Inngest } from "inngest";
import { getInngestEventKey } from "@/lib/inngest/env";

export const INNGEST_APP_ID = "dekhlo";

export const inngest = new Inngest({
  id: INNGEST_APP_ID,
  eventKey: getInngestEventKey(),
});
