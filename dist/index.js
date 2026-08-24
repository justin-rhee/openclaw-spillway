/**
 * Spillway: proactive quota-aware failover for OpenClaw.
 *
 * A dam's spillway releases water before the dam overflows. This plugin
 * watches the usage windows the gateway already collects (usage.status) and
 * steers new runs onto a configured backup lane before a watched lane's
 * window exhausts, instead of after requests start failing.
 *
 * It reads one in-process gateway method and returns model overrides from
 * the before_model_resolve hook. It never touches credentials, tokens, or
 * auth profiles.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { readFile } from "node:fs/promises";
import { decide, } from "./engine.js";
import { configuredProviderIds, parseConfig, providerOfModelRef, ruleForProvider, unresolvableSpillRules, } from "./config.js";
import { createGatewaySource, createStubSource } from "./usage.js";
/** Stable identity for a rule, shared by the disable list and the hook. */
function ruleKeyOf(rule) {
    return `${rule.watchProvider}->${rule.spillProvider}/${rule.spillModel}`;
}
export default definePluginEntry({
    id: "spillway",
    name: "Spillway",
    description: "Proactive quota-aware failover: spill work to a backup lane before a usage window runs out.",
    register(api) {
        const config = parseConfig(api.pluginConfig);
        const log = api.logger;
        if (!config.enabled) {
            log.info("spillway: disabled by config; observing nothing");
            return;
        }
        if (config.rules.length === 0) {
            log.warn("spillway: no rules configured; add plugins.entries.spillway.config.rules");
        }
        // A spillProvider the gateway does not have is a dead lane: routing a live
        // turn onto it fails the turn. Catch it here, at load, against the
        // gateway's provider registry (not usage.status, which a metered backup
        // lane legitimately never appears in). Wrapped, because a check that
        // crashed plugin load would break the exact fail-safe rule it defends: an
        // unresolvable lane disables THAT rule, nothing else.
        const disabledRuleKeys = new Set();
        const disabledRules = [];
        try {
            for (const rule of unresolvableSpillRules(config, configuredProviderIds(api.config))) {
                disabledRules.push(rule);
                disabledRuleKeys.add(ruleKeyOf(rule));
                log.warn(`spillway: rule ${rule.watchProvider} -> ${rule.spillProvider}/${rule.spillModel} is DISABLED: the gateway has no provider "${rule.spillProvider}" (typo, or that lane was never configured). Every other rule keeps working; see spillway.status.`);
            }
        }
        catch (err) {
            // Unreadable registry is ignorance, and ignorance disables nothing.
            log.debug?.(`spillway: spill lane check skipped: ${String(err)}`);
        }
        const usageByProvider = new Map();
        const spillActiveByRule = new Map();
        const recentDecisions = [];
        const stubFile = config.stubUsageFile;
        const source = stubFile
            ? createStubSource(() => readFile(stubFile, "utf8"), () => Date.now())
            : createGatewaySource((method, params, options) => dispatchGatewayMethod(method, params, options), () => Date.now());
        if (stubFile) {
            log.warn(`spillway: DEV MODE, reading usage from stub file ${stubFile} instead of usage.status`);
        }
        let timer;
        let inFlight;
        const poll = () => {
            // Single-flight: concurrent callers (interval tick, lazy hook fetch)
            // share one fetch and can all await its completion.
            if (!inFlight) {
                inFlight = (async () => {
                    try {
                        const rows = await source.fetch();
                        for (const row of rows) {
                            usageByProvider.set(row.provider, row);
                        }
                    }
                    catch (err) {
                        // Keep last-known data; staleness (maxSnapshotAgeSeconds) decides
                        // when it stops driving decisions. A fetch failure never invents a
                        // spill.
                        log.debug?.(`spillway: usage poll failed: ${String(err)}`);
                    }
                    finally {
                        inFlight = undefined;
                    }
                })();
            }
            return inFlight;
        };
        api.registerService({
            id: "spillway-poller",
            start: () => {
                void poll();
                timer = setInterval(() => void poll(), config.pollSeconds * 1000);
            },
            stop: () => {
                if (timer)
                    clearInterval(timer);
                timer = undefined;
            },
        });
        const freshUsageFor = async (provider) => {
            // The poller keeps this warm in steady state, but the first turn after a
            // runtime boot can arrive before the first poll lands. Fetch lazily when
            // the watched lane has no fresh row, so a spill is never missed to
            // startup timing.
            const existing = usageByProvider.get(provider);
            const freshEnough = existing &&
                Date.now() - existing.fetchedAtMs <= config.maxSnapshotAgeSeconds * 1000;
            if (freshEnough)
                return existing;
            await poll();
            return usageByProvider.get(provider);
        };
        api.on("before_model_resolve", async (_event, ctx) => {
            const primary = api.config.agents?.defaults?.model?.primary;
            const provider = providerOfModelRef(primary);
            const rule = ruleForProvider(config, provider);
            if (!rule || !provider)
                return;
            const contextish = (ctx ?? {});
            const turnClass = contextish.jobId ? "background" : "interactive";
            const ruleKey = ruleKeyOf(rule);
            const wasActive = spillActiveByRule.get(ruleKey) ?? false;
            const decision = decide({
                config,
                rule,
                usage: await freshUsageFor(provider),
                turnClass,
                spillActive: wasActive,
                spillLaneMissing: disabledRuleKeys.has(ruleKey),
                nowMs: Date.now(),
            });
            if (stubFile) {
                log.info(`spillway decision: provider=${provider} used=${decision.usedPercent ?? "none"} class=${turnClass} spill=${decision.spill} reason=${decision.reason}`);
            }
            spillActiveByRule.set(ruleKey, decision.spill);
            recentDecisions.push({
                atMs: Date.now(),
                provider,
                turnClass,
                decision,
            });
            if (recentDecisions.length > 50)
                recentDecisions.shift();
            if (decision.spill !== wasActive) {
                if (decision.spill) {
                    log.info(`spillway: ${provider} at ${decision.usedPercent ?? "?"}% (${decision.reason}); spilling ${turnClass} work to ${rule.spillProvider}/${rule.spillModel}`);
                }
                else {
                    log.info(`spillway: ${provider} back under threshold (${decision.reason}); returning to primary`);
                }
            }
            if (decision.spill) {
                return {
                    providerOverride: rule.spillProvider,
                    modelOverride: rule.spillModel,
                };
            }
            return;
        });
        api.registerGatewayMethod("spillway.status", ({ respond }) => {
            respond(true, {
                config: {
                    threshold: config.threshold,
                    margin: config.margin,
                    backgroundThreshold: config.backgroundThreshold ?? null,
                    pollSeconds: config.pollSeconds,
                    allowAnthropic: config.allowAnthropic,
                    rules: config.rules,
                },
                disabledRules: disabledRules.map((rule) => ({
                    rule,
                    reason: "spill-lane-not-configured",
                })),
                usage: Object.fromEntries(usageByProvider),
                spillActive: Object.fromEntries(spillActiveByRule),
                recentDecisions: recentDecisions.slice(-10),
            });
        });
    },
});
