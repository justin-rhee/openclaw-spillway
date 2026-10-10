# openclaw-spillway

[![tests](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml)

One plain OpenClaw plugin for usage windows: **polls the usage numbers the gateway already collects**, **steers new runs to a backup lane before the window runs out**, and **degrades to exactly your existing failover on missing data**. It is about 500 lines of TypeScript, all in process, no daemon, and it never sees or touches credentials.

It was built after usage limits kept landing mid task, the turn stalling until a window reset hours later, while the gateway knew the whole time: OpenClaw polls the exact percentage for its status display and draws a tidy bar, then routes every request as if the number didn't exist. Failover only wakes up after a request has already failed. A dam's spillway releases water before the dam overflows; this releases work before the window runs out.

## Use it if

- your agent runs on a subscription lane with 5-hour or weekly usage windows
- you've configured model fallbacks and still hit mid-task rate limit stalls
- you'd rather spend a metered backup lane than lose an afternoon to a reset clock

## How it works

Three small parts. A poller reads the gateway's own `usage.status` method every few minutes, the same data `/status` renders; there's no HTTP and no tokens involved. A pure decision engine compares the worst usage window of each watched lane against a threshold, with a hysteresis margin so two lanes hovering at the line never ping-pong: crossing 80 starts the spill, and work only returns once usage drops below 70. While a spill is active, a `before_model_resolve` hook returns a provider and model override for each new run; once usage falls back under the line it stops returning the override and OpenClaw's normal selection takes over on the next turn. There's no sticky state to unwind and nothing to clean up.

Missing data, stale data, or an errored provider row all decide "do nothing", so ignorance never causes a reroute. Background work spills earlier than you do: turns arriving from cron jobs use a threshold 20 points lower by default, so scheduled busywork moves to the backup lane while live conversations keep the primary until it's genuinely near the line.

## Install

```bash
openclaw plugins install git:github.com/justin-rhee/openclaw-spillway
```

It needs a rule and the hook permission that goes with it, since `before_model_resolve` is a raw conversation hook and installed plugins have to opt in:

```json5
{
  plugins: {
    entries: {
      spillway: {
        enabled: true,
        hooks: { allowConversationAccess: true },
        config: {
          rules: [
            { watchProvider: "openai-codex",
              spillProvider: "openrouter",
              spillModel: "deepseek/deepseek-chat" },
          ],
        },
      },
    },
  },
}
```

After a gateway restart spillway logs a line at startup, and it says what it sees any time through the `spillway.status` gateway method, which returns the effective config, the latest usage rows, and the last ten routing decisions with their reasons. Thresholds are configurable per rule or globally: `threshold` (default 80), `margin` (default 10), `backgroundThreshold` (default 20 under the threshold), `pollSeconds` (default 300), `maxSnapshotAgeSeconds` (default 900). The manifest schema documents every field and its range.

## The Anthropic question

Spillway refuses to route on Anthropic usage windows by default. Those windows only exist on subscription OAuth logins, and Anthropic's legal documentation restricts subscription OAuth to Claude Code and its own native apps. A config flag (`allowAnthropic: true`) exists for operators who have read that policy and made their own call, but the default is off, a test pins it off at 99 percent usage, and the plugin doesn't need it to be useful, because the same mechanism covers every other lane with a usage window.

## What it won't do

It doesn't give you more quota; it moves work onto a backup lane you usually pay for per token. The numbers it reads stay out of sight, going to the log and to `spillway.status` rather than your screen; if you want them visible while you work, [headroom](https://github.com/justin-rhee/headroom) puts Claude usage and OpenRouter spend in the macOS menu bar.

A backup lane that dies after boot still takes the first spilled turn. At startup each rule's spill provider has to resolve to something the gateway has configured, so a typo disables that rule alone and says why in the log, but a key revoked at hour forty gets none of that, and neither does an exhausted backup quota; the circuit breaker that would close it is the half not built yet. Session model pins are invisible to it, so a `/model` pin doesn't stop a spill override on that turn. Background detection is best effort: cron-driven turns carry a job id and classify as background, everything else counts as interactive. Usage payload shapes vary by provider and version; anything the normalizer can't read becomes no data, which means do nothing, never a guess. The soak covers one machine on macOS; other platforms and openclaw versions rest on the CI matrix and the compatibility pin, not a live run.

## How I tested it

31 offline tests, run with `npm test`. They cover the exact boundary (spill at 80.0, not at 79.9), hysteresis hold and release, background floors, the Anthropic default staying off at 99 percent usage, and every fail-safe path: missing data, stale data, an errored provider row, an empty window list.

The load-bearing mutation flips the threshold comparison from `>=` to `>` in `src/engine.ts`, and exactly one test goes red, the one named for the headline promise. That mutation and its revert were run for this release. `npm run typecheck` compiles against the real `openclaw` plugin SDK types, pinned at 2026.6.11, so the compiler checks the hook signature, the service registration, and the gateway method contract.

The live soak ran against a real gateway, with a stub usage file standing in for the provider numbers, and the receipt is which lane the runtime actually tried rather than what the decision function returned: primary at 50 percent, backup at 85, primary again at 65. It also caught what the offline suite couldn't, a boot race where the first turn after a restart resolved its model before any usage had been polled; that one is in the [ADR](docs/ADR.md).

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you run into any issues, or anything that looks off, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).