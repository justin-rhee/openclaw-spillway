/**
 * The decision engine. Pure functions only: no clocks, no network, no state.
 * Everything time- or IO-shaped is passed in, so every behavior the README
 * promises is provable in a unit test.
 */
/** Providers whose usage windows exist only on subscription OAuth logins that
 * Anthropic restricts to its own apps. Refused unless the operator opts in. */
const ANTHROPIC_PROVIDER_IDS = new Set(["anthropic"]);
export function isAnthropicProvider(provider) {
    return (ANTHROPIC_PROVIDER_IDS.has(provider) || provider.startsWith("anthropic-"));
}
/** The worst (highest) used percent across a lane's windows, or undefined when
 * the lane reports no usable window. */
export function worstUsedPercent(usage) {
    let worst;
    for (const w of usage.windows) {
        if (typeof w.usedPercent !== "number" || Number.isNaN(w.usedPercent)) {
            continue;
        }
        if (worst === undefined || w.usedPercent > worst) {
            worst = w.usedPercent;
        }
    }
    return worst;
}
export function effectiveThreshold(config, rule, turnClass) {
    if (turnClass === "background") {
        return (rule.backgroundThreshold ??
            config.backgroundThreshold ??
            Math.max(config.threshold - 20, 10));
    }
    return rule.threshold ?? config.threshold;
}
/**
 * Decide whether the current run should spill to the rule's backup lane.
 *
 * Fail-safe by construction: missing, stale, or errored usage data always
 * decides "no spill". The plugin can only ever fail back to openclaw's
 * normal (reactive) behavior, never invent a reroute from ignorance.
 */
export function decide(args) {
    const { config, rule, usage, turnClass, spillActive, nowMs } = args;
    if (!config.enabled) {
        return { spill: false, reason: "disabled" };
    }
    if (!rule) {
        return { spill: false, reason: "no-rule-for-provider" };
    }
    if (args.spillLaneMissing) {
        // Checked once at load against the gateway's provider registry. Ahead of
        // the hysteresis branch on purpose: a spill already in flight must drop
        // the moment its lane is known to be dead, not ride the margin down.
        return { spill: false, rule, reason: "spill-lane-not-configured" };
    }
    if (isAnthropicProvider(rule.watchProvider) && !config.allowAnthropic) {
        return {
            spill: false,
            rule,
            reason: "anthropic-excluded-by-default",
        };
    }
    if (!usage) {
        return { spill: false, rule, reason: "no-usage-data" };
    }
    if (usage.error) {
        return { spill: false, rule, reason: "usage-error" };
    }
    const ageMs = nowMs - usage.fetchedAtMs;
    if (ageMs > config.maxSnapshotAgeSeconds * 1000) {
        return { spill: false, rule, reason: "usage-stale" };
    }
    const worst = worstUsedPercent(usage);
    if (worst === undefined) {
        return { spill: false, rule, reason: "no-usable-window" };
    }
    const threshold = effectiveThreshold(config, rule, turnClass);
    // Hysteresis: entering a spill takes >= threshold; leaving it requires
    // dropping below threshold - margin. Two lanes hovering at the line never
    // ping-pong.
    const spill = spillActive
        ? worst >= threshold - config.margin
        : worst >= threshold;
    return {
        spill,
        rule,
        usedPercent: worst,
        reason: spill
            ? spillActive
                ? "spill-held"
                : "threshold-crossed"
            : spillActive
                ? "recovered"
                : "under-threshold",
    };
}
