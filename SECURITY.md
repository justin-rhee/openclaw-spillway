# Security policy. openclaw-spillway

## Posture

openclaw-spillway is provided as-is, with NO WARRANTY (see LICENSE). Use it as one
control among several, never as a sole guarantee.

Spillway is a routing plugin, not a security tool, but it holds two promises with
security weight. It never reads, stores, or transmits credentials: its only data
source is the gateway's own in-process `usage.status` method, and its only output
is a per-run model override. And it refuses to act on Anthropic usage windows
unless the operator sets `allowAnthropic: true`, because those windows exist only
on subscription OAuth logins that Anthropic restricts to its own applications.
The default-off behavior is enforced by code and pinned by a test, not promised
by documentation alone.

The structural limit to state plainly: spillway runs inside the gateway process
with the trust of any installed plugin. It cannot protect you from other plugins,
from a compromised gateway, or from a provider misreporting its own usage
numbers. A misreported window degrades spillway to doing nothing, which is the
failure direction it is built to prefer.

## Validation status

The offline suite (22 tests) has been RUN and passes on the release commit,
including the boundary test, the hysteresis tests, the fail-safe paths, and the
test pinning the Anthropic opt-out at 99 percent usage. A load-bearing mutation
(threshold comparison flipped from `>=` to `>`) was planted, observed red on
exactly the headline-promise test, and reverted green before release. A live
soak has been RUN against openclaw 2026.6.11 in an isolated credential-free
dev profile: spill, release, and fail-safe behavior were all observed on real
turns, and one cold-start defect it surfaced was fixed before release. The
soak covers one machine and one version; the README discloses the same.

## Reporting a vulnerability

Report privately via a GitHub security advisory on this repository (Security
tab, "Report a vulnerability"). Please do not open a public issue for a
suspected vulnerability. Give a reasonable window for a fix first.
