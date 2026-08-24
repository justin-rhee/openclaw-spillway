# Changelog

All notable changes to openclaw-spillway. Versions follow semver; the git tag
for each release matches the version in package.json.

## 0.2.2

- ships compiled output in dist/. ClawHub refuses a TypeScript entry with no compiled
  runtime, which openclaw's own git install never needed because it transpiles .ts
  itself. Neither the plugin inspector nor the publish dry-run caught this; only the
  publish did.
- CI rebuilds and refuses any difference against the committed dist/, because a
  committed build artifact drifts from its source silently.

## 0.2.1

- openclaw.plugin.json carried version 0.1.0 while package.json and the release tag
  said 0.2.0, so the gateway and any registry reading the manifest saw the wrong
  version. Both now read 0.2.1. No behaviour change.

## 0.2.0

- a rule whose `spillProvider` does not resolve against the gateway's configured
  providers now disables itself at load, logs why, and is listed under
  `disabledRules` in `spillway.status`; other rules are unaffected
- the check never throws and never blocks plugin load, because a plugin that
  refuses to start would violate the same fail-safe rule it exists to defend
- validated against the provider registry rather than the usage snapshot: a
  metered backup lane legitimately has no usage window, so checking there would
  have fired on the normal configuration
- 31 tests, up from 22

## 0.1.0

Initial release.

- proactive quota-aware failover: reads the gateway's own usage windows and
  steers runs to a configured backup lane before a window exhausts
- hysteresis (enter at threshold, release at threshold minus margin) and
  background reserve floors (cron turns spill earlier than interactive ones)
- fail-safe by construction: missing, stale, or errored usage data never
  causes a reroute
- Anthropic-OAuth lanes excluded by default behind a tested config flag
- `spillway.status` gateway method for live decisions and config
- `stubUsageFile` dev option so a soak can run with no credentials
- 22 offline tests, a load-bearing mutation probe, and a live soak against
  openclaw 2026.6.11 that caught and fixed a cold-start race before release
