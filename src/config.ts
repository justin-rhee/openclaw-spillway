/**
 * Config parsing. The manifest's JSON schema validates shape before the
 * plugin loads; this layer applies defaults and clamps so the engine always
 * receives a complete, sane config even if validation was skipped.
 */

import type { SpillRule, SpillwayConfig } from "./engine.js";

export const DEFAULTS = {
  enabled: true,
  pollSeconds: 300,
  threshold: 80,
  margin: 10,
  maxSnapshotAgeSeconds: 900,
  allowAnthropic: false,
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(Math.max(n, min), max);
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function parseRule(raw: unknown): SpillRule | undefined {
  if (!isRecord(raw)) return undefined;
  const watchProvider = raw["watchProvider"];
  const spillProvider = raw["spillProvider"];
  const spillModel = raw["spillModel"];
  if (
    typeof watchProvider !== "string" ||
    typeof spillProvider !== "string" ||
    typeof spillModel !== "string" ||
    !watchProvider ||
    !spillProvider ||
    !spillModel
  ) {
    return undefined;
  }
  const rule: SpillRule = { watchProvider, spillProvider, spillModel };
  if (typeof raw["threshold"] === "number") {
    rule.threshold = num(raw["threshold"], DEFAULTS.threshold, 1, 100);
  }
  if (typeof raw["backgroundThreshold"] === "number") {
    rule.backgroundThreshold = num(raw["backgroundThreshold"], 60, 1, 100);
  }
  return rule;
}

export function parseConfig(raw: unknown): SpillwayConfig {
  const r = isRecord(raw) ? raw : {};
  const rulesRaw = Array.isArray(r["rules"]) ? r["rules"] : [];
  const rules: SpillRule[] = [];
  for (const item of rulesRaw) {
    const rule = parseRule(item);
    if (rule) rules.push(rule);
  }
  const config: SpillwayConfig = {
    enabled: bool(r["enabled"], DEFAULTS.enabled),
    pollSeconds: num(r["pollSeconds"], DEFAULTS.pollSeconds, 60, 3600),
    threshold: num(r["threshold"], DEFAULTS.threshold, 1, 100),
    margin: num(r["margin"], DEFAULTS.margin, 0, 50),
    maxSnapshotAgeSeconds: num(
      r["maxSnapshotAgeSeconds"],
      DEFAULTS.maxSnapshotAgeSeconds,
      60,
      86_400,
    ),
    allowAnthropic: bool(r["allowAnthropic"], DEFAULTS.allowAnthropic),
    rules,
  };
  if (typeof r["backgroundThreshold"] === "number") {
    config.backgroundThreshold = num(r["backgroundThreshold"], 60, 1, 100);
  }
  if (typeof r["stubUsageFile"] === "string" && r["stubUsageFile"]) {
    config.stubUsageFile = r["stubUsageFile"];
  }
  return config;
}

/**
 * Provider ids the gateway has in its own configured provider catalog
 * (config.models.providers, keyed by provider id).
 *
 * Deliberately not the usage snapshot: a metered backup lane has no quota
 * window, so it never appears in usage.status while being perfectly well
 * configured. Validating a spill lane against usage rows would fire on the
 * normal setup.
 *
 * Returns undefined when the catalog cannot be read at all. Ignorance yields
 * no verdict, the same way ignorance never yields a spill.
 */
export function configuredProviderIds(
  gatewayConfig: unknown,
): Set<string> | undefined {
  if (!isRecord(gatewayConfig)) return undefined;
  const models = gatewayConfig["models"];
  if (!isRecord(models)) return undefined;
  const providers = models["providers"];
  if (!isRecord(providers)) return undefined;
  const ids = new Set(Object.keys(providers).filter((id) => id.length > 0));
  return ids.size > 0 ? ids : undefined;
}

/**
 * Rules whose spillProvider is not a provider the gateway has: a typo, or a
 * lane that was never set up. Each one is disabled on its own; every other
 * rule keeps working. An unreadable registry disables nothing.
 */
export function unresolvableSpillRules(
  config: SpillwayConfig,
  configured: ReadonlySet<string> | undefined,
): SpillRule[] {
  if (!configured) return [];
  return config.rules.filter((r) => !configured.has(r.spillProvider));
}

export function ruleForProvider(
  config: SpillwayConfig,
  provider: string | undefined,
): SpillRule | undefined {
  if (!provider) return undefined;
  return config.rules.find((r) => r.watchProvider === provider);
}

/** "provider/model..." -> provider (first segment only; model ids may contain slashes). */
export function providerOfModelRef(ref: unknown): string | undefined {
  if (typeof ref !== "string" || !ref) return undefined;
  const idx = ref.indexOf("/");
  return idx > 0 ? ref.slice(0, idx) : ref;
}
