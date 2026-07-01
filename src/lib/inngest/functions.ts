import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createRunLog,
  writeRunLogProgress,
  finalizeRunLog,
  type ScrapeTrigger,
} from "@/lib/scraper/run";
import {
  scrapeAndFilter,
  processJobBatch,
  mergeStats,
  emptyStats,
} from "@/lib/scraper/pipeline";
import { failStaleRuns } from "@/lib/scraper/stale-runs";
import { getAllConfig } from "@/lib/config";
import { sendDigestEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Scrape a single saved search — as a durable, batched orchestration.
 *
 * scrape+filter runs once; then the new jobs are processed in batches, each a
 * separate `step.run` (its own fresh 300s budget + independent retry). Inngest
 * memoizes completed steps, so a retry never re-scrapes or re-evaluates work
 * that already finished. Total work can therefore exceed 300s without ever
 * timing out a single invocation. Fanned out by `scrapeUser`, one per search;
 * `concurrency: { limit: 2 }` keeps LinkedIn load gentle.
 */
export const scrapeSearch = inngest.createFunction(
  {
    id: "scrape-search",
    concurrency: { limit: 2 },
    retries: 1,
    triggers: [{ event: "scrape/search.requested" }],
  },
  async ({ event, step }) => {
    const { userId, searchId, trigger } = event.data as {
      userId: string;
      searchId: string;
      trigger?: ScrapeTrigger;
    };
    const runTrigger: ScrapeTrigger = trigger ?? "scheduled";

    const { runLogId, startedAt } = await step.run("start", () =>
      createRunLog(userId, searchId, runTrigger)
    );

    let stats = emptyStats();
    try {
      const config = await step.run("config", () => getAllConfig());
      // Clamp to >=1 so a misconfigured (0/negative) value can't make the batch
      // loop non-terminating or produce invalid step IDs.
      const batchSize = Math.max(1, Number(config.scrape_batch_size) || 8);

      const prep = await step.run("scrape-filter", () =>
        scrapeAndFilter(userId, searchId, config)
      );

      stats = prep.stats;
      const jobs = prep.jobs;
      const batchCount = Math.ceil(jobs.length / batchSize);

      for (let i = 0; i < jobs.length; i += batchSize) {
        const idx = i / batchSize;
        stats.phase = `evaluating (batch ${idx + 1}/${batchCount})`;

        // Heartbeat + cancel check before each (expensive) batch.
        const { cancelled } = await step.run(`checkpoint-${idx}`, () =>
          writeRunLogProgress(runLogId, stats)
        );
        if (cancelled) {
          stats.phase = "cancelled";
          await step.run("finalize-cancelled", () =>
            finalizeRunLog(runLogId, startedAt, stats, "cancelled")
          );
          return { status: "cancelled", stats };
        }

        const batch = jobs.slice(i, i + batchSize);
        const delta = await step.run(`batch-${idx}`, () =>
          processJobBatch(userId, batch, prep.evalContext, config)
        );
        mergeStats(stats, delta);
      }

      // Honor a cancel that arrived during the final batch (the pre-batch
      // checkpoints above can't catch it) before marking the run completed.
      const { cancelled: cancelledLate } = await step.run("final-checkpoint", () =>
        writeRunLogProgress(runLogId, stats)
      );
      if (cancelledLate) {
        stats.phase = "cancelled";
        await step.run("finalize-cancelled-late", () =>
          finalizeRunLog(runLogId, startedAt, stats, "cancelled")
        );
        return { status: "cancelled", stats };
      }

      stats.phase = "completed";
      await step.run("finalize-completed", () =>
        finalizeRunLog(runLogId, startedAt, stats, "completed")
      );
      return { status: "completed", stats };
    } catch (err: any) {
      stats.phase = "failed";
      await step.run("finalize-failed", () =>
        finalizeRunLog(runLogId, startedAt, stats, "failed", err?.message)
      );
      throw err;
    }
  }
);

/**
 * Scrape one user: fan out one `scrapeSearch` per active search (or the given
 * subset), then send a single digest once they all finish. Shared by the cron
 * and the manual Run All / play buttons — both just emit `scrape/user.requested`.
 */
export const scrapeUser = inngest.createFunction(
  { id: "scrape-user", triggers: [{ event: "scrape/user.requested" }] },
  async ({ event, step }) => {
    const { userId, searchIds, trigger } = event.data as {
      userId: string;
      searchIds?: string[];
      trigger?: ScrapeTrigger;
    };
    const runTrigger: ScrapeTrigger = trigger ?? "scheduled";

    // Pin the digest window once, inside a step (stable across retries).
    const startedAt = await step.run("started-at", async () =>
      new Date().toISOString()
    );

    // Resolve the searches to run: an explicit subset, else all active.
    const ids = await step.run("resolve-searches", async () => {
      if (searchIds && searchIds.length > 0) return searchIds;
      const sc = await createServiceClient();
      const { data } = await sc
        .from("saved_searches")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true);
      return (data ?? []).map((s) => s.id);
    });

    if (ids.length === 0) return { userId, searches: 0 };

    // Fan out: each search runs in its own invocation with a fresh budget.
    // allSettled (not all) so one search failing doesn't reject the whole
    // function and suppress the digest for the searches that DID succeed —
    // each failed search already records its own `failed` run_logs row.
    const outcomes = await Promise.allSettled(
      ids.map((searchId) =>
        step.invoke(`scrape-${searchId}`, {
          function: scrapeSearch,
          data: { userId, searchId, trigger: runTrigger },
        })
      )
    );
    const failed = outcomes.filter((o) => o.status === "rejected").length;
    if (failed > 0) {
      logger.warn("inngest", "some searches failed during fan-out", {
        userId,
        failed,
        total: ids.length,
      });
    }

    // Fan in: one digest covering every job created since this run began.
    await step.run("digest", async () => {
      try {
        await sendDigestEmail(userId, startedAt, runTrigger);
      } catch (err: any) {
        logger.error("inngest", "digest email failed", {
          userId,
          error: err?.message,
        });
      }
      return null;
    });

    return { userId, searches: ids.length };
  }
);

/**
 * Scheduled scrape — runs at 6am / noon / 5pm Pacific (the TZ= prefix makes
 * Inngest track PST↔PDT automatically). Sweeps orphaned runs, then dispatches
 * one `scrape/user.requested` per eligible user (resume + active searches);
 * each user's fan-out and digest are handled by `scrapeUser`.
 */
export const scheduledScrape = inngest.createFunction(
  {
    id: "scheduled-scrape",
    triggers: [{ cron: "TZ=America/Los_Angeles 0 6,12,17 * * *" }],
  },
  async ({ step }) => {
    await step.run("sweep-stale", async () => {
      const sc = await createServiceClient();
      return failStaleRuns(sc);
    });

    const userIds = await step.run("load-users", async () => {
      const sc = await createServiceClient();
      const { data } = await sc
        .from("profiles")
        .select("id")
        .not("resume_text", "is", null);
      return (data ?? []).map((u) => u.id);
    });

    if (userIds.length === 0) return { dispatched: 0 };

    await step.sendEvent(
      "dispatch-users",
      userIds.map((userId) => ({
        name: "scrape/user.requested",
        data: { userId, trigger: "scheduled" as ScrapeTrigger },
      }))
    );

    return { dispatched: userIds.length };
  }
);
