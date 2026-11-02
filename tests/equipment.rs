use lineup_simulator::{model::*, runtime::*};
use serde_json::{Value, json};
use std::sync::{Arc, atomic::AtomicU8};
#[test]
fn edited_equipment_attributes_change_compiled_stats_and_damage() {
    let res = resource_dir();
    let data: Value =
        serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let bow = ts.iter().find(|t| t.id == "bow-1").unwrap().config.clone();
    let weapon = bow["equipment"]["weapon"]["itemHrid"].as_str().unwrap();
    let mut changed = data.clone();
    changed["itemDetailMap"][weapon]["equipmentDetail"]["combatStats"]["rangedDamage"] = json!(50.);
    changed["itemDetailMap"][weapon]["equipmentDetail"]["combatEnhancementBonuses"]["rangedDamage"] =
        json!(5.);
    let file = std::env::temp_dir().join(format!("lineup-equipment-{}.json", std::process::id()));
    std::fs::write(&file, serde_json::to_vec(&changed).unwrap()).unwrap();
    let mut a = Adapter::new(&res, &res.join("game-data.json")).unwrap();
    let mut b = Adapter::new(&res, &file).unwrap();
    let request = json!({"configs":[bow.clone()],"hours":0.25});
    let original = a.request(request.clone()).unwrap();
    let edited = b.request(request).unwrap();
    assert!(
        edited["players"][0]["equipStats"]["rangedDamage"]
            .as_f64()
            .unwrap()
            > original["players"][0]["equipStats"]["rangedDamage"]
                .as_f64()
                .unwrap()
    );
    let mut settings = Settings::default();
    settings.zone = "/actions/combat/aqua_planet".into();
    settings.hours = 0.25;
    let control = Arc::new(AtomicU8::new(0));
    let mut r1 = Runtime::new(
        &res,
        &res.join("game-data.json"),
        json!({"hash":digest(&data)}),
    )
    .unwrap();
    let mut r2 = Runtime::new(&res, &file, json!({"hash":digest(&changed)})).unwrap();
    let before = r1
        .run(vec![bow.clone()], &settings, &control, false)
        .unwrap();
    let after = r2.run(vec![bow], &settings, &control, false).unwrap();
    assert_ne!(before.metrics.dps, after.metrics.dps);
    assert_ne!(before.versions, after.versions);
    let _ = std::fs::remove_file(file);
}
#[test]
fn equipment_rules_reject_two_hand_offhand() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut bow = ts.iter().find(|t| t.id == "bow-1").unwrap().config.clone();
    bow["equipment"]["off_hand"] =
        json!({"itemHrid":"/items/knights_aegis_refined","enhancementLevel":12});
    let mut a = Adapter::new(&res, &res.join("game-data.json")).unwrap();
    assert!(
        a.request(json!({"configs":[bow]}))
            .unwrap_err()
            .to_string()
            .contains("双手")
    );
}

#[test]
fn different_planets_dungeons_and_tiers_are_simulated() {
    let res = resource_dir();
    let data = res.join("game-data.json");
    let raw: Value = serde_json::from_slice(&std::fs::read(&data).unwrap()).unwrap();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut rt = Runtime::new(&res, &data, json!({"test":"target-selection"})).unwrap();
    let control = Arc::new(AtomicU8::new(0));
    let mut checked = vec![];
    for (h, z) in raw["actionDetailMap"].as_object().unwrap() {
        if !z["combatZoneInfo"].is_object() {
            continue;
        }
        let dungeon = z["combatZoneInfo"]["isDungeon"] == true;
        if !dungeon && !h.contains("planet") {
            continue;
        }
        let names = if dungeon {
            vec!["shield", "nature", "fire", "water", "bow"]
        } else {
            vec!["nature", "fire", "bow"]
        };
        let cfg: Vec<_> = names
            .iter()
            .map(|c| {
                ts.iter()
                    .find(|t| t.profession == *c && t.tier == 1)
                    .unwrap()
                    .config
                    .clone()
            })
            .collect();
        for tier in [0, 1, 3] {
            let s = Settings {
                zone: h.clone(),
                tier,
                hours: 0.02,
                ..Settings::default()
            };
            let r = rt.run(cfg.clone(), &s, &control, false).unwrap();
            assert!(r.metrics.hours >= 0.02);
            assert_eq!(r.result["isDungeon"], dungeon);
            checked.push(json!({"zone":h,"tier":tier,"party":cfg.len(),"elapsedHours":r.metrics.hours,"dps":r.metrics.dps}));
        }
    }
    assert!(checked.len() >= 15);
    std::fs::write(
        "outputs/星球地牢难度验证.json",
        serde_json::to_vec_pretty(&checked).unwrap(),
    )
    .unwrap();
}
