# Changelog

All notable changes to openclaw-spillway. Versions follow semver; the git tag
for each release matches the version in package.json.

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
