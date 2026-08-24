# Architecture Decision Records (ADRs)

Why this plugin refuses to act on numbers it isn't sure about, and what a live soak found that 22 passing tests could not.

## A single threshold would have flipped work back and forth all afternoon

The obvious design is one number: spill above 80 percent, come back below 80 percent. It falls apart the moment a lane sits near the line, because usage doesn't climb smoothly, it ticks up and settles and ticks up again, and every crossing moves the next turn to a different provider. You'd get a conversation whose turns alternate between two models for no reason the user can see.

So entering a spill and leaving one use different numbers. Crossing the threshold starts it, and work only returns once usage drops below the threshold minus a margin, 80 and 70 with the defaults. The margin is configurable per rule because the right gap depends on how fast your window refills, but it can't be zero, and the test that pins the boundary checks 80.0 exactly rather than 79.9, since an off-by-one on the comparison is the whole promise.

## Deciding to do nothing was harder to commit to than deciding to route

Every failure path in this plugin resolves to "do nothing". A missing usage row, a snapshot older than the age limit, a provider that returned an error, a window list with nothing usable in it: none of them spill. That sounds obvious written down, and it wasn't obvious while building. My instinct when a number went missing near a limit was that something might be wrong and the plugin should do something about it.

Acting on absent data is worse than not acting. The failure it produces is invisible, since routing a turn to a backup lane looks identical whether it was the right call or a guess, and the operator finds out from a bill or a broken run days later. Not acting fails the way the system already failed before the plugin existed. Five tests cover the paths individually rather than one test covering them as a group, so a change that quietly loses one of them turns a specific test red.

## The Anthropic lanes are off by default even though the mechanism works on them fine

Anthropic usage windows only exist on subscription OAuth logins, and Anthropic's own policy documentation restricts subscription OAuth to Claude Code and its native apps. Routing on those windows would work. Whether it should is a question about someone's account, not about code, so the plugin doesn't decide it for them.

The flag exists (`allowAnthropic: true`) because an operator who has read that policy is better placed to make the call than I am. The default is off, a test pins it off at 99 percent usage where the pressure to spill is highest, and the plugin doesn't need it: every other lane with a usage window works the same way. Shipping the capability while defaulting it off, rather than leaving it out and letting people patch it in, keeps the decision visible in the config instead of buried in a fork.

## Scheduled work spills earlier than you do

A heartbeat and a live conversation both consume the same window, and only one of them is waiting for you. Background turns therefore use a lower threshold, twenty points under the interactive one by default, so cron work moves to the backup lane while there's still room left for anything you type.

Classification is best effort and the README says so: turns carrying a job id count as background, everything else counts as interactive. Getting it wrong in the cautious direction costs a scheduled task a slightly more expensive lane. Getting it wrong the other way costs you the quota you were saving, which is why the ambiguous case resolves to interactive.

## The first turn after a restart resolved its model before the first poll had landed

The unit suite passed on every path and the soak still caught this one. A gateway that has just booted has no usage data yet, the poller is a few seconds from its first read, and the very first turn resolves its model against an empty snapshot. An over-threshold lane got missed silently, exactly once per restart, which is the sort of gap that would have taken months to notice in the wild and looked like nothing when it happened.

It was only visible because the soak ran against a real runtime and watched which lane each turn actually attempted, rather than asserting on what the decision function returned. The hook now fetches usage itself when it has no fresh row for a watched lane, with a single-flight poller so a burst of turns produces one read. The fix shipped before the first release. The README's testing section carries a one-line version and points here, because a green suite that missed this is the honest context for the rest of the numbers.

## The one lane this plugin never checks is the one it routes you onto

Every other limit in the README is the plugin doing less than you might want. This one is
different in kind. Point a rule at a provider that was never configured and spillway will
move a turn onto a dead lane, where it fails with an auth error sooner than it would have
failed on the primary. For a tool whose entire pitch is not failing mid-task, that is the
single configuration where installing it is worse than not installing it.

The fail-safe rule above is already the answer, applied to the other side of the decision.
"Ignorance never causes a reroute" governs the watched lane's usage data and says nothing
about the spill lane's health, so the plugin refuses to act on a number it cannot trust and
then acts on a destination it has never checked. Same class of error, opposite end.

What closes most of it is a pair. The first half shipped in 0.2.0: a config-load check that
the spill provider resolves against the gateway's own configured providers, which needs no
network and catches the realistic failure of a typo or a lane nobody set up. It validates
against the provider registry rather than the usage snapshot, and that distinction is the
whole design. A metered backup lane legitimately has no usage window, so a check reading the
usage rows would have fired on the correct configuration, which is worse than not checking.

It also refuses to throw. An unresolvable lane disables that one rule and leaves the others
running, because a plugin that blocks gateway startup to protect you from a misconfiguration
has broken the same fail-safe rule it exists to defend.

The second half is not built. The gateway fires `after_provider_response` with an HTTP
status, so a spilled turn coming back 401 or 5xx is observable, and after a couple of those
a rule could drop itself. Failing back to not overriding lands the operator exactly where
they would be without the plugin, which is the floor this should never go below.

A startup probe of the spill lane is the obvious first idea and it is the weakest of the
three, which is why it is third and optional. It cannot see a lane that dies after boot,
which is the normal case for a gateway running for weeks, and a real probe request spends
tokens on a metered lane at every restart to answer a question that will be stale by the
time it matters.

None of this makes the failure impossible, and the README will keep saying so. The breaker
is reactive, so the first spilled turn onto a newly dead lane still fails; what changes is
that the second one does not. A lane that is healthy at boot and revoked at hour forty still
costs one turn. Closing that last gap means probing immediately before every spill, which
spends a request at exactly the moment the plugin exists to conserve quota, and still races.
One turn per lane-death, with a floor of never-worse-than-absent, is the honest ceiling.

## The SDK is a devDependency, and promoting it to a runtime dependency would make installs worse

The plugin imports two runtime values from `openclaw/plugin-sdk`, both declared public subpaths in the package's own exports map, and the gateway supplies them from its own installation when it loads the plugin. Nothing is resolved from the plugin's own `node_modules`, which is why this package has no runtime dependencies at all and its install instructions name no install step.

Declaring `openclaw` as a peer dependency would state that relationship more formally and would also, on any modern npm, pull an entire second copy of the gateway into the plugin directory to satisfy it. The version requirement lives in the manifest's `compat` block instead, where the gateway reads it and refuses to load the plugin against an API it doesn't match. The typecheck runs against the real pinned SDK rather than hand-written type stubs, so the contract is checked by the compiler on every CI run.
