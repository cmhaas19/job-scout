import { Inngest } from "inngest";

/**
 * Inngest client for Job Scout.
 *
 * Drives the scheduled scrape (cron) and per-search fan-out. In production the
 * event/signing keys are read from `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`
 * (set by the Vercel↔Inngest integration); locally the dev server needs neither.
 */
export const inngest = new Inngest({ id: "job-scout" });

export type ScrapeTriggerType = "scheduled" | "on_demand";

/** Requests a scrape of a single saved search (the per-search worker unit). */
export type ScrapeSearchRequested = {
  name: "scrape/search.requested";
  data: { userId: string; searchId: string; trigger?: ScrapeTriggerType };
};

/**
 * Requests a scrape for one user: fans out per active search (or the given
 * subset) and sends a single digest. Emitted by the cron and by the manual
 * Run All / play buttons.
 */
export type ScrapeUserRequested = {
  name: "scrape/user.requested";
  data: { userId: string; searchIds?: string[]; trigger?: ScrapeTriggerType };
};
