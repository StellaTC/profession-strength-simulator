//! Actual short simulation in disposable UI QA data; never writes live user data.
use lineup_simulator::{model::*, runtime::*, search, store::Store, workflow::Report};
use serde_json::{Value, json};
use std::sync::{Arc, atomic::AtomicU8};
fn main() -> anyhow::Result<()> {
    let home = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("work/ui-qa-home");
    let db = Store::open(&home.join("simulator.sqlite"))?;
    let res = resource_dir();
    let ts: Vec<Template> = serde_json::from_slice(&std::fs::read(res.join("templates.json"))?)?;
    let data: Value = serde_json::from_slice(&std::fs::read(res.join("game-data.json"))?)?;
    let ver = versions(&data, &ts);
    let mut cfg = ts
        .iter()
        .find(|t| t.profession == "water" && t.tier == 1)
        .unwrap()
        .config
        .clone();
    for (_, v) in cfg["levels"].as_object_mut().unwrap() {
        *v = json!(1);
    }
    for (_, v) in cfg["triggerMap"].as_object_mut().unwrap() {
        *v = json!([]);
    }
    cfg["levels"]["stamina"] = json!(1000);
    cfg["houseRooms"] = json!({});
    cfg["guildBuffs"] = json!({});
    cfg["equipment"] =
        json!({"weapon":{"itemHrid":"/items/wooden_water_staff","enhancementLevel":0}});
    cfg["food"] = json!([]);
    cfg["drinks"] = json!([]);
    let settings = Settings {
        zone: "/actions/combat/pirate_cove".into(),
        tier: 5,
        hours: 0.1,
        ..Default::default()
    };
    let mut rt = Runtime::new(&res, &res.join("game-data.json"), ver.clone())?;
    let mut r = rt.run(vec![cfg; 5], &settings, &Arc::new(AtomicU8::new(0)), true)?;
    r.id = "qa-low-training-tag-fixture".into();
    let notes = lineup_simulator::workflow::notes(&r);
    assert!(!notes.0.is_empty());
    let report = Report {
        id: "qa-low-training-tag-job".into(),
        settings,
        versions: ver,
        status: "比较完成（界面验收样本，非终测）".into(),
        finished: chrono::Utc::now().to_rfc3339(),
        runs: vec![r.id.clone()],
    };
    db.put("run", &r.id, &r)?;
    db.put("comparison", &report.id, &search::thin_rows(&[r]))?;
    db.put("report", &report.id, &report)?;
    println!("{:?}", notes);
    Ok(())
}
