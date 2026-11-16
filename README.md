# openclaw-spillway

[![tests](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/openclaw-spillway/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![OpenClaw plugin](https://img.shields.io/badge/OpenClaw-plugin-blue.svg) ![no daemon](https://img.shields.io/badge/runs-in%20process-brightgreen.svg)

Moves an OpenClaw agent onto a backup model before your plan's usage limit runs out, instead of waiting for a request to fail.

Usage limits kept landing mid task, the turn stalling until a window reset hours later, while the gateway knew the whole time. OpenClaw polls the exact percentage for its status bar, then routes every request as if the number didn't exist. A dam's spillway releases water before the dam overflows; this releases work before the window runs out.

## Use it if

- your agent runs on a subscription lane with 5-hour or weekly usage windows
- you've configured model fallbacks and still hit mid-task rate limit stalls
- you'd rather spend a metered backup lane than lose an afternoon to a reset clock

## Install

About 500 lines of TypeScript, in process, and it never sees credentials:

```bash
openclaw plugins install git:github.com/justin-rhee/openclaw-spillway
```

Then add a rule and the hook permission, since `before_model_resolve` is a raw conversation hook plugins have to opt into:

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

After a gateway restart it logs a line at startup, and `spillway.status` returns its config, the latest usage and its last ten routing decisions with reasons. Defaults: `threshold` 80, `margin` 10, `backgroundThreshold` 20 under, `pollSeconds` 300, `maxSnapshotAgeSeconds` 900.

## How it works

1. a poller reads the gateway's own `usage.status` every few minutes, the same numbers `/status` shows
2. crossing 80 percent on a watched lane starts a spill, and work only returns below 70, so two lanes near the line don't ping-pong
3. during a spill, the hook points each new run at the backup model; afterwards OpenClaw's normal choice takes over on the next turn
4. cron turns spill 20 points earlier, so scheduled busywork moves before your live conversations

Missing, stale or errored data always means do nothing, so ignorance never causes a reroute.

## The Anthropic question

It won't route on Anthropic usage windows by default. Those exist only on subscription logins, and Anthropic's legal documentation restricts subscription OAuth to Claude Code and its own apps. `allowAnthropic: true` exists for operators who've read that policy and made their own call; the default is off, and a test pins it off at 99 percent usage.

## What it won't do

- give you more quota; it moves work to a backup lane you usually pay for per token
- show the numbers on your screen; [headroom](https://github.com/justin-rhee/headroom) puts them in the macOS menu bar
- notice a backup lane that dies after startup, such as a revoked key or an exhausted quota, since the circuit breaker for it isn't built yet
- see a session's `/model` pin, so a pinned turn can still spill
- detect background work perfectly: cron turns carry a job id, and everything else counts as interactive
- read a usage format it doesn't recognize, which becomes no data and so no action
- promise other platforms or OpenClaw versions beyond the CI matrix and its version pin, since the live soak covers one macOS machine

## How I tested it

- 31 offline tests: `npm test`, covering the exact boundary (80.0 spills, 79.9 doesn't), hysteresis, background floors and every fail-safe path
- flipping the threshold comparison from `>=` to `>` turns exactly one test red, the one named for the headline promise
- a live soak against a real gateway tried primary at 50 percent, backup at 85, primary again at 65, and caught a boot race the offline suite couldn't; that one is in the [ADR](docs/ADR.md)

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

<!-- related:start -->
## Related

- [headroom](https://github.com/justin-rhee/headroom): shows Claude usage and OpenRouter spend in the macOS menu bar

Part of a small set of tools I pulled out of my own agent harness. I use them myself and read every issue. More on my [GitHub profile](https://github.com/justin-rhee).
<!-- related:end -->
