# Browser Rust engine integration

Audit baseline: project `fe0438173a60bb8b81151998dac38f7d07ab8c0b`, upstream `wow121/mwi-fastsim@de2e774565b328907866aa9ff86689c2aa28d121`. See `engine/UPSTREAM.md` for provenance. This is a browser engine; the desktop implementation is unchanged.

The implementation is gated by `VERIFIED_RUST_MODES` in `src/combat/services/rustEngine.js`. `normal` (including dungeons), `labyrinth`, and `task` now default to `rust-wasm-3`; the actual dispatcher and production browser Worker were checked against JS, in addition to 41 differential cases. Guild trial now defaults to `rust-trial-wasm-1` with its independent pinned rules and catalog; single runs and optimizer subjobs share the global execution pool. Its separate gate covers 33 cases (32 complete event/RNG traces and a 100-member, 60-minute healing stress run), plus the unchanged eight upstream reference fixtures. Results carry the actual implementation version, including explicit JS and failure fallback; cache/checkpoint keys separate implementations. Rules and implementation versions remain separate. This is per-mode enablement, not a claim that the whole original migration plan is complete.

Planner simulations explicitly omit unused wipe details in both implementations. A 720-hour failing-dungeon regression verifies identical combat statistics; normal detailed output retains wipe logs. Long simulations use additional shared concurrency credits to reduce simultaneous large buffers.

Build with `pnpm engine:build`; requires Rust with the `wasm32-unknown-unknown` target. `pnpm build` includes WASM. CI builds the module before running JS/WASM differential tests. Native unit checks are `pnpm engine:test`. `tests/combat/rust-engine-differential.test.ts` is skipped if the artifact is missing, so always build it before a local engine audit.

The Worker adapter retains the old result/progress protocol. A WASM error restarts the complete input/seed in JS. Shared Worker cancellation discards the instance. The header allows users to force JavaScript.

Measured reports, source fingerprints, exact coverage and outstanding work are in `outputs/rust-migration/` (local deliverables; ignored by the repository's existing outputs policy).

Trial specifics: `engine/src/trial.rs` owns floors, points, completion and failure. `Queue::trial()` reproduces heap-js equal-time ordering without ordinary-combat time rounding. Trial-only monster scaling, regeneration, parry attempts, stack lifecycle and healing attribution are explicit. `rustTrialEngine.js` uses a separate WASM instance/catalog so switching modes never mutates the other mode's data. The page and optimizer remain Vue/TypeScript; all trial battle events execute in Rust on successful automatic runs.
