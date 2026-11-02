use lineup_simulator::{model::*, runtime::*};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn boosts(v: &Value) -> BTreeMap<String, [f64; 2]> {
    let mut m = BTreeMap::new();
    for b in v["players"][0]["permanentBuffs"].as_array().unwrap() {
        let e = m
            .entry(b["typeHrid"].as_str().unwrap().to_owned())
            .or_insert([0.; 2]);
        e[0] += b["ratioBoost"].as_f64().unwrap_or(0.);
        e[1] += b["flatBoost"].as_f64().unwrap_or(0.);
    }
    m
}
#[test]
fn every_preset_has_all_five_shrines_and_their_effects_compile() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let data: Value =
        serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
    let mut adapter = Adapter::new(&res, &res.join("game-data.json")).unwrap();
    let buffs = data["guildBuffDetailMap"].as_object().unwrap();
    let combat: Vec<_> = buffs
        .iter()
        .filter(|(_, d)| d["isCombat"] == true)
        .collect();
    assert_eq!(combat.len(), 5);
    let mut report = vec![];
    for t in &ts {
        assert_eq!(t.config["guildBuffs"].as_object().unwrap().len(), 5);
        for (h, _) in &combat {
            assert_eq!(t.config["guildBuffs"][*h], 5);
        }
        let with = adapter
            .request(json!({"configs":[t.config],"hours":0.001}))
            .unwrap();
        let mut zero = t.config.clone();
        for (_, v) in zero["guildBuffs"].as_object_mut().unwrap() {
            *v = json!(0);
        }
        let without = adapter
            .request(json!({"configs":[zero],"hours":0.001}))
            .unwrap();
        let a = boosts(&with);
        let b = boosts(&without);
        let mut expected = BTreeMap::<String, [f64; 2]>::new();
        for (_, detail) in &combat {
            for buff in detail["buffs"].as_array().unwrap() {
                let e = expected
                    .entry(buff["typeHrid"].as_str().unwrap().to_owned())
                    .or_default();
                e[0] += buff["ratioBoost"].as_f64().unwrap()
                    + 4. * buff["ratioBoostLevelBonus"].as_f64().unwrap();
                e[1] += buff["flatBoost"].as_f64().unwrap()
                    + 4. * buff["flatBoostLevelBonus"].as_f64().unwrap();
            }
        }
        for (k, want) in &expected {
            for j in 0..2 {
                let delta = a.get(k).unwrap_or(&[0.; 2])[j] - b.get(k).unwrap_or(&[0.; 2])[j];
                assert!(
                    (delta - want[j]).abs() < 1e-9,
                    "{} {} got {delta} expected {}",
                    t.id,
                    k,
                    want[j]
                );
            }
        }
        report.push(json!({"preset":t.id,"guildBuffs":t.config["guildBuffs"],"compiledBuffDeltas":expected}));
    }
    assert_eq!(ts.len(), 27);
    std::fs::write("outputs/全预设五级神龛验证.json",serde_json::to_vec_pretty(&json!({"presets":27,"allCombatShrines":5,"level":5,"actualBuffCompilationVerified":true,"details":report})).unwrap()).unwrap();
}
#[test]
fn migration_also_updates_high_revision_custom_templates_without_touching_equipment() {
    let mut templates = vec![Template {
        id: "edited".into(),
        profession: "water".into(),
        tier: 0,
        version: 99,
        config: json!({"levels":{"magic":170},"equipment":{"weapon":{"itemHrid":"custom"}},"guildBuffs":{"x":3}}),
        provenance: json!({}),
    }];
    let equipment = templates[0].config["equipment"].clone();
    let levels = templates[0].config["levels"].clone();
    let guild = json!({"a":5,"b":5});
    set_preset_shrines(&mut templates, &guild);
    assert_eq!(templates[0].config["guildBuffs"], guild);
    assert_eq!(templates[0].config["equipment"], equipment);
    assert_eq!(templates[0].config["levels"], levels);
    assert_eq!(templates[0].version, 99);
}
