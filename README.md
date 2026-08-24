# openclaw-spillway

[![tests](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml)

I hit my plan's usage limits often enough that I keep multiple accounts and a mental map of which one has quota left. The limit never lands politely. It lands mid task: the turn stalls, and whatever the agent was doing waits until a window resets hours later. What finally got to me is that the gateway knew the whole time. OpenClaw polls the exact percentage for its status display, draws it as a tidy bar in the dashboard, and then routes every request as if the number didn't exist.

If your OpenClaw agent runs on any lane with a usage window, a Codex plan, a MiniMax coding plan, you have the same blind spot whether or not it's bitten you yet. Failover only wakes up after a request has already failed.

Spillway is the missing wire, about 500 lines of TypeScript. A dam's spillway releases water before the dam overflows. This plugin reads the usage numbers OpenClaw already collects and steers new runs to a backup lane before the window runs out, instead of after requests start failing.

## Use it if

- your agent runs on a subscription lane with 5-hour or weekly usage windows
- you've configured model fallbacks and still hit mid-task rate limit stalls
- background jobs and heartbeats burn quota you wanted for live conversations
- you'd rather spend a metered backup lane than lose an afternoon to a reset clock

## How it works

Three small parts, all in process, no daemon. A poller reads the gateway's own `usage.status` method every few minutes, the same data `/status` renders. There's no HTTP and no tokens involved, because the plugin never sees or touches credentials, it just reads numbers the gateway already holds.

A pure decision engine compares the worst usage window of each watched lane against a threshold. A hysteresis margin separates entering a spill from leaving it, so two lanes hovering at the line never ping-pong: crossing 80 starts the spill, and work only returns once usage drops below 70.

While a spill is active, a `before_model_resolve` hook returns a provider and model override for each new run. Once usage falls back under the line it simply stops returning the override, and OpenClaw's normal selection takes over on the next turn. There's no sticky state to unwind and nothing to clean up.

Missing data, stale data, or an errored provider row all decide "do nothing", so ignorance never causes a reroute and the plugin degrades to exactly the reactive failover you already had.

Background work spills earlier than you do. Turns that arrive from cron jobs use a lower threshold, 20 points lower by default, so your agent's scheduled busywork moves to the backup lane while live conversations keep the primary until it's genuinely near the line.

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
            {
              watchProvider: "openai-codex",
              spillProvider: "openrouter",
              spillModel: "deepseek/deepseek-chat",
            },
          ],
        },
      },
    },
  },
}
```

After a gateway restart spillway logs a line at startup, and it will say what it sees at any time through the `spillway.status` gateway method, which returns the effective config, the latest usage rows, and the last ten routing decisions with their reasons.

Thresholds are configurable per rule or globally: `threshold` (default 80), `margin` (default 10), `backgroundThreshold` (default 20 under the threshold), `pollSeconds` (default 300), `maxSnapshotAgeSeconds` (default 900). The manifest schema documents every field and its range.

## The Anthropic question

Spillway refuses to route on Anthropic usage windows by default. Those windows only exist on subscription OAuth logins, and Anthropic's legal documentation restricts subscription OAuth to Claude Code and its own native apps. A config flag (`allowAnthropic: true`) exists for operators who have read that policy and made their own call, but the default is off, a test pins it off at 99 percent usage, and the plugin doesn't need it to be useful, because the same mechanism covers every other lane with a usage window.

## What it won't do

It doesn't give you more quota. It spends the quota you have on the right things at the right time, and the backup lane is usually a metered lane you pay per token.

The numbers it reads stay out of sight, going to the log and to `spillway.status` rather than to your screen. If you want the windows visible while you work, [headroom](https://github.com/justin-rhee/headroom) puts Claude usage and OpenRouter spend in the macOS menu bar.

It only half protects you from a backup lane that isn't there. At startup it checks that each rule's spill provider resolves to something the gateway actually has configured, so a typo or an unconfigured lane disables that rule on its own, says why in the log, and appears under `disabledRules` in `spillway.status`. Every other rule keeps working. What it cannot catch is a lane that was fine at boot and died later, a revoked key or an exhausted backup quota, and there the first spilled turn still lands on a dead lane. The circuit breaker that would close that gap, dropping a rule once its lane starts returning auth errors, is the half I haven't built. See [docs/ADR.md](docs/ADR.md).

Session model pins are invisible to it, so pinning a model with `/model` for one session doesn't stop a spill override applying to that turn. I disable the plugin when it fights a pin I care about.

Background detection is best effort, since cron-driven turns carry a job id and classify as background while everything else counts as interactive.

Usage payload shapes vary by provider and by openclaw version. The normalizer is deliberately tolerant, and anything it can't read becomes "no data", which means "do nothing", never a guess.

The soak so far covers one machine and one openclaw version, 2026.6.11 on macOS. Other versions and platforms rest on the CI matrix and the compatibility pin, not on a live run.

## How I tested it

22 offline tests, run them with `npm test`. They cover the exact boundary (spill at 80.0, not at 79.9), hysteresis hold and release, background floors, the Anthropic default staying off at 99 percent usage, and every fail-safe path: missing data, stale data, an errored provider row, an empty window list.

The load-bearing mutation flips the threshold comparison from `>=` to `>` in `src/engine.ts`, and exactly one test goes red, the one named for the headline promise. I ran that mutation and its revert as part of this release.

`npm run typecheck` compiles the plugin against the real `openclaw` package's plugin SDK types, pinned at 2026.6.11, so the hook signature, the service registration, and the gateway method contract are checked by the compiler, not by hope.

The live soak ran against openclaw 2026.6.11, with a stub usage file standing in for the provider numbers. The receipt is which lane the runtime actually tried rather than what the decision function returned. It went primary at 50 percent, backup at 85 with the spill announced in the log, primary again at 65. It also caught something 22 green tests couldn't, a boot race where the first turn after a restart resolved its model before any usage had been polled. That story is in the [ADR](docs/ADR.md).

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

Design decisions and what changed while building it: [docs/ADR.md](docs/ADR.md).

---

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you run into any issues, or anything that looks off, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).
