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

It was only visible because the soak ran against a real runtime and watched which lane each turn actually attempted, rather than asserting on what the decision function returned. The hook now fetches usage itself when it has no fresh row for a watched lane, with a single-flight poller so a burst of turns produces one read. The fix shipped before the first release, and the story stays in the README's testing section because a green suite that missed this is the honest context for the rest of the numbers.

## The SDK is a devDependency, and promoting it to a runtime dependency would make installs worse

The plugin imports two runtime values from `openclaw/plugin-sdk`, both declared public subpaths in the package's own exports map, and the gateway supplies them from its own installation when it loads the plugin. Nothing is resolved from the plugin's own `node_modules`, which is why this package has no runtime dependencies at all and its install instructions name no install step.

Declaring `openclaw` as a peer dependency would state that relationship more formally and would also, on any modern npm, pull an entire second copy of the gateway into the plugin directory to satisfy it. The version requirement lives in the manifest's `compat` block instead, where the gateway reads it and refuses to load the plugin against an API it doesn't match. The typecheck runs against the real pinned SDK rather than hand-written type stubs, so the contract is checked by the compiler on every CI run.
