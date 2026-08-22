import { describe, expect, it } from "vitest";

import {
  decide,
  effectiveThreshold,
  worstUsedPercent,
  type LaneUsage,
  type SpillRule,
  type SpillwayConfig,
} from "../src/engine.js";

const NOW = 1_700_000_000_000;

function config(overrides: Partial<SpillwayConfig> = {}): SpillwayConfig {
  return {
    enabled: true,
    pollSeconds: 300,
    threshold: 80,
    margin: 10,
    maxSnapshotAgeSeconds: 900,
    allowAnthropic: false,
    rules: [],
    ...overrides,
  };
}

const RULE: SpillRule = {
  watchProvider: "openai-codex",
  spillProvider: "openrouter",
  spillModel: "deepseek/deepseek-chat",
};

function usage(usedPercent: number, overrides: Partial<LaneUsage> = {}): LaneUsage {
  return {
    provider: "openai-codex",
    windows: [{ label: "5h", usedPercent }],
    fetchedAtMs: NOW,
    ...overrides,
  };
}

function run(args: {
  usedPercent?: number;
  usage?: LaneUsage;
  cfg?: SpillwayConfig;
  rule?: SpillRule;
  turnClass?: "interactive" | "background";
  spillActive?: boolean;
}) {
  return decide({
    config: args.cfg ?? config(),
    rule: args.rule ?? RULE,
    usage:
      args.usage ??
      (args.usedPercent !== undefined ? usage(args.usedPercent) : undefined),
    turnClass: args.turnClass ?? "interactive",
    spillActive: args.spillActive ?? false,
    nowMs: NOW,
  });
}

describe("the headline promise: spill before the window exhausts", () => {
  // Break-the-claim: if this test passes while the comparison in decide() is
  // wrong or removed, the README's one promise is false. This is the suite's
  // load-bearing red: flip `>=` to `>` (or drop it) in decide() and the
  // boundary case below goes red.
  it("spills at the threshold, not after it", () => {
    expect(run({ usedPercent: 80 }).spill).toBe(true);
    expect(run({ usedPercent: 79.9 }).spill).toBe(false);
    expect(run({ usedPercent: 100 }).spill).toBe(true);
  });

  it("returns the rule so the caller can route to the configured lane", () => {
    const d = run({ usedPercent: 85 });
    expect(d.rule).toBe(RULE);
    expect(d.usedPercent).toBe(85);
  });

  it("judges the worst window, not the first", () => {
    const d = run({
      usage: usage(10, {
        windows: [
          { label: "5h", usedPercent: 10 },
          { label: "Week", usedPercent: 91 },
        ],
      }),
    });
    expect(d.spill).toBe(true);
  });
});

describe("hysteresis: no ping-pong at the line", () => {
  it("stays spilled until usage drops below threshold minus margin", () => {
    // Entered the spill at 81. At 78 (>= 70) it holds; at 69 it releases.
    expect(run({ usedPercent: 78, spillActive: true }).spill).toBe(true);
    expect(run({ usedPercent: 70, spillActive: true }).spill).toBe(true);
    expect(run({ usedPercent: 69, spillActive: true }).spill).toBe(false);
  });

  it("does not enter a spill inside the margin band", () => {
    expect(run({ usedPercent: 75, spillActive: false }).spill).toBe(false);
  });
});

describe("reserve floors: background work spills earlier", () => {
  it("defaults background threshold to threshold minus 20", () => {
    expect(effectiveThreshold(config(), RULE, "background")).toBe(60);
    expect(effectiveThreshold(config(), RULE, "interactive")).toBe(80);
  });

  it("spills background work while interactive work keeps the lane", () => {
    expect(run({ usedPercent: 65, turnClass: "background" }).spill).toBe(true);
    expect(run({ usedPercent: 65, turnClass: "interactive" }).spill).toBe(false);
  });

  it("honors per-rule background thresholds", () => {
    const rule: SpillRule = { ...RULE, backgroundThreshold: 40 };
    expect(run({ usedPercent: 45, turnClass: "background", rule }).spill).toBe(true);
  });
});

describe("anthropic lanes are excluded by default", () => {
  const anthropicRule: SpillRule = { ...RULE, watchProvider: "anthropic" };
  const anthropicUsage = usage(99, { provider: "anthropic" });

  it("never routes on anthropic usage without the explicit opt-in", () => {
    const d = run({ rule: anthropicRule, usage: anthropicUsage });
    expect(d.spill).toBe(false);
    expect(d.reason).toBe("anthropic-excluded-by-default");
  });

  it("routes only after the operator opts in", () => {
    const d = run({
      rule: anthropicRule,
      usage: anthropicUsage,
      cfg: config({ allowAnthropic: true }),
    });
    expect(d.spill).toBe(true);
  });
});

describe("fail-safe: ignorance never causes a reroute", () => {
  it("no usage data means no spill", () => {
    const d = run({});
    expect(d.spill).toBe(false);
    expect(d.reason).toBe("no-usage-data");
  });

  it("stale usage data means no spill, even at 99 percent", () => {
    const stale = usage(99, { fetchedAtMs: NOW - 901_000 });
    const d = run({ usage: stale });
    expect(d.spill).toBe(false);
    expect(d.reason).toBe("usage-stale");
  });

  it("an errored provider row means no spill", () => {
    const errored = usage(99, { error: "Token expired" });
    expect(run({ usage: errored }).spill).toBe(false);
  });

  it("a row with no usable window means no spill", () => {
    const empty = usage(0, { windows: [] });
    expect(run({ usage: empty }).spill).toBe(false);
  });

  it("disabled means no spill regardless of everything else", () => {
    const d = run({ usedPercent: 99, cfg: config({ enabled: false }) });
    expect(d.spill).toBe(false);
  });
});

describe("worstUsedPercent", () => {
  it("ignores malformed windows", () => {
    const u = usage(0, {
      windows: [
        { label: "bad", usedPercent: Number.NaN },
        { label: "ok", usedPercent: 42 },
      ],
    });
    expect(worstUsedPercent(u)).toBe(42);
  });
});
