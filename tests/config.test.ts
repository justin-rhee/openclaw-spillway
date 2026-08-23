import { describe, expect, it } from "vitest";

import { configuredProviderIds, unresolvableSpillRules } from "../src/config.js";
import type { SpillRule, SpillwayConfig } from "../src/engine.js";

const RULE: SpillRule = {
  watchProvider: "openai-codex",
  spillProvider: "openrouter",
  spillModel: "deepseek/deepseek-chat",
};

function config(rules: SpillRule[]): SpillwayConfig {
  return {
    enabled: true,
    pollSeconds: 300,
    threshold: 80,
    margin: 10,
    maxSnapshotAgeSeconds: 900,
    allowAnthropic: false,
    rules,
  };
}

/** The gateway's own provider registry: models.providers, keyed by provider id. */
function gatewayConfig(providers: Record<string, unknown>): unknown {
  return { models: { providers } };
}

describe("configuredProviderIds: the provider registry, never the usage snapshot", () => {
  it("reads the ids out of the gateway's configured provider catalog", () => {
    const ids = configuredProviderIds(
      gatewayConfig({ "openai-codex": { baseUrl: "x", models: [] }, openrouter: {} }),
    );
    expect(ids && [...ids].sort()).toEqual(["openai-codex", "openrouter"]);
  });

  it("counts a metered backup lane that reports no usage window at all", () => {
    // The trap this check must not fall into: a pay-per-token backup lane has
    // no quota window, so it never appears in usage.status. It is configured.
    const ids = configuredProviderIds(gatewayConfig({ openrouter: { models: [] } }));
    expect(ids?.has("openrouter")).toBe(true);
  });

  it("returns no verdict when the gateway exposes no provider catalog", () => {
    expect(configuredProviderIds(undefined)).toBeUndefined();
    expect(configuredProviderIds({})).toBeUndefined();
    expect(configuredProviderIds(gatewayConfig({}))).toBeUndefined();
  });

  it("returns no verdict instead of throwing on a malformed config", () => {
    expect(configuredProviderIds("nonsense")).toBeUndefined();
    expect(configuredProviderIds({ models: { providers: [] } })).toBeUndefined();
  });
});

describe("unresolvableSpillRules", () => {
  const typo: SpillRule = { ...RULE, spillProvider: "openrouterr" };

  it("names only the rules whose spill lane the gateway does not have", () => {
    const ids = configuredProviderIds(
      gatewayConfig({ "openai-codex": {}, openrouter: {} }),
    );
    expect(unresolvableSpillRules(config([RULE, typo]), ids)).toEqual([typo]);
  });

  it("disables nothing when the registry could not be read", () => {
    expect(unresolvableSpillRules(config([typo]), undefined)).toEqual([]);
  });
});
