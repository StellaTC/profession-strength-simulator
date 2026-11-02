//! Creates disposable UI fixtures only. Never targets the user's live database.
use lineup_simulator::{model::*, runtime::*, search, store::Store, workflow::Report};
use serde_json::{Value, json};
use std::sync::{Arc, atomic::AtomicU8};
fn main() -> anyhow::Result<()> {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("work/ui-qa-home");
    std::fs::create_dir_all(&root)?;
    let db = Store::open(&root.join("simulator.sqlite"))?;
    let res = resource_dir();
    let ts: Vec<Template> = serde_json::from_slice(&std::fs::read(res.join("templates.json"))?)?;
    let data: Value = serde_json::from_slice(&std::fs::read(res.join("game-data.json"))?)?;
    let ver = versions(&data, &ts);
    let mut rt = Runtime::new(&res, &res.join("game-data.json"), ver.clone())?;
    let ctl = Arc::new(AtomicU8::new(0));
    for (index, (zone, tier, classes)) in [
        ("sorcerers_tower", 0, vec!["water", "fire", "nature"]),
        ("sorcerers_tower", 1, vec!["sword", "mace", "spear"]),
        (
            "pirate_cove",
            1,
            vec!["water", "bow", "crossbow", "shield", "nature"],
        ),
        (
            "pirate_cove",
            1,
            vec!["fire", "nature", "bow", "spear", "shield"],
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let configs = classes
            .iter()
            .map(|c| {
                ts.iter()
                    .find(|t| t.profession == *c && t.tier == 1)
                    .unwrap()
                    .config
                    .clone()
            })
            .collect();
        let settings = Settings {
            zone: format!("/actions/combat/{zone}"),
            tier,
            hours: 0.1,
            ..Default::default()
        };
        let mut run = rt.run(configs, &settings, &ctl, true)?;
        run.id = format!("ui-fixture-{index}");
        let id = format!("ui-fixture-job-{index}");
        let report = Report {
            id: id.clone(),
            settings,
            versions: ver.clone(),
            status: "比较完成（界面验收样本，非终测）".into(),
            finished: chrono::Utc::now().to_rfc3339(),
            runs: vec![run.id.clone()],
        };
        db.put("run", &run.id, &run)?;
        db.put("comparison", &id, &search::thin_rows(&[run]))?;
        db.put("report", &id, &report)?;
    }
    println!("{}", root.display());
    Ok(())
}
