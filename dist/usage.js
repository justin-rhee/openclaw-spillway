/**
 * Usage sources. The engine only ever sees LaneUsage rows; where they come
 * from is an adapter choice:
 *
 *  - gateway source: the gateway's own `usage.status` method, dispatched
 *    in-process. No HTTP, no tokens, no credentials. The plugin reads the
 *    numbers openclaw already collects for /status.
 *  - stub source: a JSON payload from a file or test. This is what the test
 *    suite and the dev loop drive.
 */
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asFiniteNumber(v) {
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n))
            return n;
    }
    return undefined;
}
function normalizeWindow(raw) {
    if (!isRecord(raw))
        return undefined;
    const usedPercent = asFiniteNumber(raw["usedPercent"]) ??
        asFiniteNumber(raw["used_percent"]) ??
        asFiniteNumber(raw["pct"]);
    if (usedPercent === undefined)
        return undefined;
    const label = typeof raw["label"] === "string" ? raw["label"] : "window";
    const resetAt = asFiniteNumber(raw["resetAt"]) ?? asFiniteNumber(raw["reset_at"]);
    return { label, usedPercent, ...(resetAt !== undefined ? { resetAt } : {}) };
}
function normalizeRow(raw, nowMs) {
    if (!isRecord(raw))
        return undefined;
    const provider = typeof raw["provider"] === "string" ? raw["provider"] : undefined;
    if (!provider)
        return undefined;
    const windowsRaw = Array.isArray(raw["windows"]) ? raw["windows"] : [];
    const windows = [];
    for (const w of windowsRaw) {
        const norm = normalizeWindow(w);
        if (norm)
            windows.push(norm);
    }
    const error = typeof raw["error"] === "string" ? raw["error"] : undefined;
    return {
        provider,
        windows,
        fetchedAtMs: nowMs,
        ...(error !== undefined ? { error } : {}),
    };
}
/**
 * Accepts the shapes the gateway plausibly returns for a usage summary:
 * `{ providers: [...] }`, a bare array of rows, or anything else (which
 * normalizes to no data, and no data never drives a spill).
 */
export function normalizeUsagePayload(payload, nowMs) {
    const rows = isRecord(payload) && Array.isArray(payload["providers"])
        ? payload["providers"]
        : Array.isArray(payload)
            ? payload
            : [];
    const out = [];
    for (const raw of rows) {
        const row = normalizeRow(raw, nowMs);
        if (row)
            out.push(row);
    }
    return out;
}
export function createGatewaySource(dispatch, now, timeoutMs = 10_000) {
    return {
        async fetch() {
            const res = await dispatch("usage.status", {}, { timeoutMs });
            if (!res.ok) {
                throw new Error(res.error?.message ?? "usage.status dispatch failed");
            }
            return normalizeUsagePayload(res.payload, now());
        },
    };
}
export function createStubSource(read, now) {
    return {
        async fetch() {
            const text = await read();
            return normalizeUsagePayload(JSON.parse(text), now());
        },
    };
}
