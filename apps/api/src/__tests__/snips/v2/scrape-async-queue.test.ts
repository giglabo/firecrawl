// Regression guard for the fork's self-hosted async path: NuQ must dispatch
// jobs with NUQ_RABBITMQ_URL unset.
//
// nuq-prefetch-worker claims queued jobs into 'active' and hands them to
// RabbitMQ. With no broker configured the hand-off silently drops them, while
// getJobToProcess() only ever selects 'queued' -- so the job is invisible to
// every worker until the lock reaper releases it a minute later, at which
// point prefetch (250ms poll) claims it again. Async jobs livelock forever
// while sync /v2/scrape, which runs inline via skipNuq, keeps working.
//
// Upstream never sees this: both test-server.yml and our own fork-e2e.yml used
// to start a real rabbitmq service, so the broker-less configuration we
// actually ship in docker-compose.selfhost.yaml was exercised nowhere.
import {
  describeIf,
  TEST_SELF_HOST,
  HAS_PLAYWRIGHT,
  ALLOW_TEST_SUITE_WEBSITE,
  TEST_SUITE_WEBSITE,
  TEST_API_URL,
} from "../lib";
import { batchScrape, scrapeTimeout, idmux, Identity } from "./lib";
import request from "supertest";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-async-queue",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

describeIf(TEST_SELF_HOST && HAS_PLAYWRIGHT && ALLOW_TEST_SUITE_WEBSITE)(
  "async queue without a broker",
  () => {
    it(
      "batch scrape drains the queue and returns documents",
      async () => {
        const response = await batchScrape(
          {
            urls: [TEST_SUITE_WEBSITE, `${TEST_SUITE_WEBSITE}/?async=1`],
            formats: ["markdown"],
          },
          identity,
        );

        expect(response.status).toBe("completed");
        expect(response.data.length).toBe(2);
        for (const doc of response.data) {
          expect(doc).toHaveProperty("markdown");
          expect(doc.markdown!.length).toBeGreaterThan(0);
        }
      },
      scrapeTimeout * 2,
    );

    // Failure path: a job that cannot succeed must still terminate the batch.
    // Under the livelock the batch never leaves "scraping" at all, so this
    // fails on the bug for the same reason the happy path does -- but it also
    // guards the case where a job errors before any worker result is recorded.
    it(
      "batch scrape terminates even when a URL is unreachable",
      async () => {
        const start = await request(TEST_API_URL)
          .post("/v2/batch/scrape")
          .set("Authorization", `Bearer ${identity.apiKey}`)
          .set("Content-Type", "application/json")
          .send({
            urls: ["http://127.0.0.1:1/nothing-is-listening-here"],
            formats: ["markdown"],
          });

        expect(start.statusCode).toBe(200);
        expect(typeof start.body.id).toBe("string");

        const deadline = Date.now() + scrapeTimeout;
        let status = "scraping";
        while (status === "scraping" && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const poll = await request(TEST_API_URL)
            .get("/v2/batch/scrape/" + encodeURIComponent(start.body.id))
            .set("Authorization", `Bearer ${identity.apiKey}`)
            .send();
          expect(poll.statusCode).toBe(200);
          status = poll.body.status;
        }

        // The point is that it stopped, not how it stopped: an unreachable URL
        // may land as completed-with-no-documents or as failed.
        expect(status).not.toBe("scraping");
      },
      scrapeTimeout * 2,
    );
  },
);
