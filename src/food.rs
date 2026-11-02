//! One-hour, member-specific OOM retry, with the selected food carried forward.
use crate::model::{Run, rank};
use serde_json::{Value, json};
pub const DONUT: &str = "/items/spaceberry_donut";
pub const GUMMY: &str = "/items/star_fruit_gummy";

pub fn next_member(run: &Run, attempted: &[usize]) -> Option<usize> {
    let (_, oom) = crate::workflow::notes(run);
    oom.into_iter().find(|i| !attempted.contains(i)
        && run.configs[*i]["food"].as_array().is_some_and(|food|
            food.iter().any(|h| h == DONUT) && !food.iter().any(|h| h == GUMMY)))
}
pub fn retry_with<F>(mut best: Run, catalog: &Value, mut runner: F) -> anyhow::Result<Run>
where F: FnMut(Vec<Value>) -> anyhow::Result<Run> {
    let mut attempted = vec![];
    let mut changes = vec![];
    while let Some(i) = next_member(&best, &attempted) {
        attempted.push(i);
        let mut cfg = best.configs.clone();
        for h in cfg[i]["food"].as_array_mut().unwrap() { if h == DONUT { *h = json!(GUMMY); } }
        let trigger = &catalog["items"][GUMMY]["consumableDetail"]["defaultCombatTriggers"];
        cfg[i]["triggerMap"][GUMMY] = if trigger.is_array() { trigger.clone() } else { json!([]) };
        let coffee = best.result["coffeeAdjustment"].clone();
        let before = best.metrics.eph;
        let mut tested = runner(cfg)?;
        let accepted = rank(&tested, &best).is_lt();
        changes.push(json!({"member":i,"replaced":DONUT,"replacement":GUMMY,"beforeEph":before,"testedEph":tested.metrics.eph,"accepted":accepted}));
        if accepted { tested.result["coffeeAdjustment"] = coffee; best = tested; }
    }
    best.result["foodAdjustment"] = json!({"schemaVersion":1,"policy":"individual-oom-donut-to-gummy-v1","extraSimulations":attempted.len(),"changes":changes,"selectedFood":best.configs.iter().map(|c|c["food"].clone()).collect::<Vec<_>>()});
    Ok(best)
}
pub fn screen(runtime: &mut crate::runtime::Runtime, configs: Vec<Value>, settings: &crate::model::Settings,
    control: &std::sync::Arc<std::sync::atomic::AtomicU8>, catalog: &Value) -> anyhow::Result<Run> {
    let best = crate::coffee::screen(runtime, configs, settings, control, catalog)?;
    retry_with(best, catalog, |cfg| runtime.run(cfg, settings, control, false))
}
