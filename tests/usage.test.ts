import { describe, expect, it } from "vitest";

import { createStubSource, normalizeUsagePayload } from "../src/usage.js";

const NOW = 1_700_000_000_000;

describe("normalizeUsagePayload", () => {
  it("reads the { providers: [...] } summary shape", () => {
    const rows = normalizeUsagePayload(
      {
        providers: [
          {
            provider: "openai-codex",
            windows: [{ label: "5h", usedPercent: 25, resetAt: 123 }],
          },
        ],
      },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("openai-codex");
    expect(rows[0]?.windows[0]).toEqual({ label: "5h", usedPercent: 25, resetAt: 123 });
    expect(rows[0]?.fetchedAtMs).toBe(NOW);
  });

  it("reads a bare array and snake_case percent fields", () => {
    const rows = normalizeUsagePayload(
      [{ provider: "minimax", windows: [{ label: "plan", used_percent: 61 }] }],
      NOW,
    );
    expect(rows[0]?.windows[0]?.usedPercent).toBe(61);
  });

  it("keeps provider-reported errors so the engine can refuse to act on them", () => {
    const rows = normalizeUsagePayload(
      { providers: [{ provider: "anthropic", windows: [], error: "Token expired" }] },
      NOW,
    );
    expect(rows[0]?.error).toBe("Token expired");
  });

  it("normalizes junk to no data, never to a guess", () => {
    expect(normalizeUsagePayload(null, NOW)).toEqual([]);
    expect(normalizeUsagePayload("nonsense", NOW)).toEqual([]);
    expect(normalizeUsagePayload({ providers: [{ windows: [] }] }, NOW)).toEqual([]);
    expect(
      normalizeUsagePayload({ providers: [{ provider: "x", windows: [{}] }] }, NOW),
    ).toEqual([{ provider: "x", windows: [], fetchedAtMs: NOW }]);
  });
});

describe("stubUsageFile config", () => {
  it("is absent unless explicitly set, so production never stubs by accident", async () => {
    const { parseConfig } = await import("../src/config.js");
    expect(parseConfig({}).stubUsageFile).toBeUndefined();
    expect(parseConfig({ stubUsageFile: "" }).stubUsageFile).toBeUndefined();
    expect(parseConfig({ stubUsageFile: "/tmp/x.json" }).stubUsageFile).toBe(
      "/tmp/x.json",
    );
  });
});

describe("createStubSource", () => {
  it("drives the same normalization path as the gateway source", async () => {
    const source = createStubSource(
      () =>
        JSON.stringify({
          providers: [
            { provider: "openai-codex", windows: [{ label: "5h", pct: 88 }] },
          ],
        }),
      () => NOW,
    );
    const rows = await source.fetch();
    expect(rows[0]?.windows[0]?.usedPercent).toBe(88);
  });
});
