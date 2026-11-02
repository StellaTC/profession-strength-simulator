# Source and review record

Rust ordinary-combat engine adapted from wow121/mwi-fastsim,
commit de2e774565b328907866aa9ff86689c2aa28d121.
https://github.com/wow121/mwi-fastsim/tree/de2e774565b328907866aa9ff86689c2aa28d121/engine

That project's README identifies New Combat Simulator combat-events-2.3.0
as the original combat logic. The owner of this workspace explicitly authorized reuse
in the implementation conversation on 2026-09-23. The inspected upstream
snapshot contains no standalone license; this notice does not assert an MIT
license for the Rust translation. Preserve this source record.

Local changes and verification evidence are described in docs/RUST_ENGINE_REVIEW.md.
The guild-trial rules remain independently versioned against their pinned reference.

Guild-trial Rust rules were implemented locally against the repository's
`src/combat/guildTrialEngine` reference at StellaTC/milkywayidle-simulation-core
8805f411da28d7ad3ab2913a486a6b4e892d67d8, including the local 2026-07-15
monster balance and party-size fixes. This is not a trial engine copied from
wow121. The original JS source notices and pinned data remain intact.

Shared combat rules corrected locally after chezecow’s 2026-10-29 backend review.
See docs/战斗核心修复-0.4.2.txt. Affected rules intentionally diverge from the old
JS reference; local regression snapshots are not live-backend recordings.
