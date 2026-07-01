import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { scheduledScrape, scrapeUser, scrapeSearch } from "@/lib/inngest/functions";

// Each Inngest step runs as its own request against this route, so the 300s
// Hobby cap is a per-step budget rather than one shared across the whole run.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [scheduledScrape, scrapeUser, scrapeSearch],
});
