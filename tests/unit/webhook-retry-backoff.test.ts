import { describe, expect, it } from "vitest";
import { BACKOFF_SECONDS, MAX_ATTEMPTS, nextAttemptDelay } from "../../src/core/webhooks/webhook.service.js";

describe("nextAttemptDelay", () => {
  it("follows the exact backoff schedule for attempts 1 through MAX_ATTEMPTS", () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(nextAttemptDelay(attempt)).toBe(BACKOFF_SECONDS[attempt - 1]);
    }
  });

  it("is monotonically non-decreasing across the schedule", () => {
    let previous = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const delay = nextAttemptDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("clamps to the final backoff tier if ever called past MAX_ATTEMPTS", () => {
    expect(nextAttemptDelay(MAX_ATTEMPTS + 5)).toBe(BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]);
  });
});
