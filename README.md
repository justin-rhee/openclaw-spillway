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

Then give it a rule and the hook permission it needs (`before_model_resolve` is a raw conversation hook, so installed plugins must opt in):

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

Restart the gateway. You'll see a startup log line from spillway, and you can ask it what it sees at any time through the `spillway.status` gateway method: effective config, the latest usage rows, and the last ten routing decisions with their reasons.

Thresholds are configurable per rule or globally: `threshold` (default 80), `margin` (default 10), `backgroundThreshold` (default 20 under the threshold), `pollSeconds` (default 300), `maxSnapshotAgeSeconds` (default 900). The manifest schema documents every field and its range.

## The Anthropic question

Spillway refuses to route on Anthropic usage windows by default. Those windows only exist on subscription OAuth logins, and Anthropic's legal documentation restricts subscription OAuth to Claude Code and its own native apps. A config flag (`allowAnthropic: true`) exists for operators who have read that policy and made their own call, but the default is off, a test pins it off at 99 percent usage, and the plugin doesn't need it to be useful, because the same mechanism covers every other lane with a usage window.

## What it won't do

It doesn't give you more quota. It spends the quota you have on the right things at the right time, and the backup lane is usually a metered lane you pay per token.

It doesn't show you the numbers it reads. Decisions go to the log and to `spillway.status`, not to your screen. If you want the windows visible while you work, [headroom](https://github.com/justin-rhee/headroom) puts Claude usage and OpenRouter spend in the macOS menu bar.

It doesn't check that your backup lane actually works. Point a rule at a provider you never configured, and a spill routes turns onto a dead lane where they fail with an auth error, sooner than they would have failed on the primary. OpenClaw's normal fallback chain still catches the failure if you've set `agents.defaults.model.fallbacks`, but the simpler advice is to run one turn on your spill lane with `/model` before trusting it. A config-load check on the spill provider and a circuit breaker that stops spilling to a lane returning auth errors are both planned for v0.2, and even then the first turn onto a newly dead lane will still fail. See [docs/ADR.md](docs/ADR.md).

It can't see session-level model pins. If you pin a model with `/model` for one session, a spill override may still apply to that turn. That's a known v0.1 limit; disable the plugin if it fights a pin you care about.

Background detection is best effort. Cron-driven turns carry a job id and classify as background; everything else counts as interactive.

Usage payload shapes vary by provider and by openclaw version. The normalizer is deliberately tolerant, and anything it can't read becomes "no data", which means "do nothing", never a guess.

The soak so far covers one machine and one openclaw version (2026.6.11 on macOS). Other versions and platforms rest on the CI matrix and the compatibility pin, not on a live run.

## How I tested it

22 offline tests, run them with `npm test`. They cover the exact boundary (spill at 80.0, not at 79.9), hysteresis hold and release, background floors, the Anthropic default staying off at 99 percent usage, and every fail-safe path: missing data, stale data, an errored provider row, an empty window list.

The load-bearing mutation flips the threshold comparison from `>=` to `>` in `src/engine.ts`, and exactly one test goes red, the one named for the headline promise. I ran that mutation and its revert as part of this release.

`npm run typecheck` compiles the plugin against the real `openclaw` package's plugin SDK types, pinned at 2026.6.11, so the hook signature, the service registration, and the gateway method contract are checked by the compiler, not by hope.

The live soak ran against openclaw 2026.6.11 in an isolated dev profile with no provider keys anywhere in it. A stub usage file stood in for the provider numbers, and the receipt for each act is which lane the runtime actually tried: at 50 percent the turn went to the primary, at 85 percent spillway announced the spill and the turn genuinely attempted the backup lane, at 65 percent it returned to the primary. The soak also caught a bug the unit suite couldn't see, where the first turn after a runtime boot resolved its model before the first usage poll landed and an over-threshold lane was silently missed. The hook now fetches usage itself whenever it has no fresh row for the watched lane, and that fix shipped before this release.

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

Design decisions and what changed while building it: [docs/ADR.md](docs/ADR.md).

---

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you run into any issues, or anything that looks off, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).
