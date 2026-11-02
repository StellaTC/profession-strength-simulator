use lineup_simulator::{model::*, runtime::*};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicU8},
};
fn fixture(n: usize, name: &str) -> Value {
    serde_json::from_slice(
        &std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(format!("tests/fixtures/team-{n}-{name}.json")),
        )
        .unwrap(),
    )
    .unwrap()
}
fn run(sc: &Value) -> Value {
    let gd: Value = serde_json::from_slice(
        &std::fs::read(resource_dir().join("native-game-data.json")).unwrap(),
    )
    .unwrap();
    let gd = mwi_engine::data::GameData::from_json(&gd).unwrap();
    let mut sim = mwi_engine::sim::Sim::new(&gd, sc, true).unwrap();
    sim.simulate(sc["simulationTimeLimit"].as_f64().unwrap())
        .unwrap();
    sim.result_json()
}
#[test]
fn three_real_teams_48_hours() {
    let mut report = vec![];
    for n in 1..=3 {
        let i = fixture(n, "input");
        // Reviewed-rule local baseline; the old JS baseline is retained separately.
        // Neither fixture is a capture from the private live backend.
        let expected = fixture(n, "rules-20261029");
        let old = fixture(n, "baseline");
        let r = run(&i["scenario"]);
        let mut without_observers = i["scenario"].clone();
        without_observers["observeWeapons"] = json!(false);
        let unobserved = run(&without_observers);
        for key in [
            "attacks",
            "dungeonsCompleted",
            "dungeonsFailed",
            "deaths",
            "simulatedTime",
            "manaUsed",
            "consumablesUsed",
        ] {
            assert_eq!(r[key], expected[key], "team {n} {key}");
            assert_eq!(r[key], unobserved[key], "team {n} observer changed {key}");
        }
        let m = metrics(&r, 5);
        let attempts = r["dungeonAttemptDurations"].as_array().unwrap();
        assert_eq!(
            attempts.iter().filter(|a| a["successful"] == true).count() as f64,
            r["dungeonsCompleted"].as_f64().unwrap()
        );
        assert_eq!(
            attempts.iter().filter(|a| a["successful"] == false).count() as f64,
            r["dungeonsFailed"].as_f64().unwrap()
        );
        let finished: f64 = attempts
            .iter()
            .map(|a| a["seconds"].as_f64().unwrap())
            .sum();
        assert!((finished - r["finishedAttemptSeconds"].as_f64().unwrap()).abs() < 1e-6);
        assert!(
            (r["finishedAttemptSeconds"].as_f64().unwrap()
                + r["unfinishedAttemptSeconds"].as_f64().unwrap()
                - r["simulatedTime"].as_f64().unwrap() / 1e9)
                .abs()
                < 1e-6
        );

        let phase_damage: f64 = r["phaseDamage"]
            .as_object()
            .unwrap()
            .values()
            .flat_map(|v| v.as_array().unwrap().iter())
            .map(|n| n.as_f64().unwrap())
            .sum();
        assert!((phase_damage - m.dps * m.hours * 3600.).abs() < 1e-4);
        let phase_seconds: f64 = r["phaseSeconds"]
            .as_object()
            .unwrap()
            .values()
            .map(|n| n.as_f64().unwrap())
            .sum();
        assert!((phase_seconds - m.hours * 3600.).abs() < 1e-4);
        let before = m.player_dps.iter().sum::<f64>();
        let mut after = m.player_dps.clone();
        for i in 0..5 {
            for j in 0..5 {
                let x = r["curseTransfers"][i][j].as_f64().unwrap() / (m.hours * 3600.);
                after[i] -= x;
                after[j] += x;
            }
        }
        assert!((before - after.iter().sum::<f64>()).abs() < 1e-9);
        report.push(json!({"team":n,"engine":ENGINE_VERSION,"baselineKind":"local-reviewed-rules-not-live-backend","eph":m.eph,"completed":m.completed,"failed":m.failed,"dps":m.dps,"rawDps":m.player_dps,"attributedDps":after,"oldJsBaseline":{"completed":old["dungeonsCompleted"],"failed":old["dungeonsFailed"],"deaths":old["deaths"]},"observerBattleInvariant":true,"exactFields":["attacks","dungeonsCompleted","dungeonsFailed","deaths","simulatedTime","manaUsed","consumablesUsed"]}));
    }
    std::fs::create_dir_all("outputs").unwrap();
    std::fs::write(
        "outputs/基准验证.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
}
#[test]
fn zero_curse_and_multi_bow_conservation() {
    let mut sc = fixture(1, "input")["scenario"].clone();
    sc["simulationTimeLimit"] = json!(3600e9);
    for p in sc["players"].as_array_mut().unwrap() {
        p["equipStats"]["curse"] = json!(0.);
    }
    let r = run(&sc);
    assert_eq!(r["curseTransfers"], json!(vec![vec![0.; 5]; 5]));
    sc["players"][2]["equipStats"]["curse"] = json!(0.022);
    sc["players"][4] = sc["players"][2].clone();
    sc["players"][4]["hrid"] = json!("player5");
    let r = run(&sc);
    let a = (0..5)
        .map(|i| r["curseTransfers"][i][2].as_f64().unwrap())
        .sum::<f64>();
    let b = (0..5)
        .map(|i| r["curseTransfers"][i][4].as_f64().unwrap())
        .sum::<f64>();
    assert!(a > 0. && b > 0.);
    for i in 0..5 {
        let out = (0..5)
            .map(|j| r["curseTransfers"][i][j].as_f64().unwrap())
            .sum::<f64>();
        let bonus = r["curseAttributionByPlayer"][i]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_f64().unwrap())
            .sum::<f64>();
        assert!(out <= bonus + 1e-6);
    }
}
#[test]
fn all_templates_compile() {
    let res = resource_dir();
    let templates: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    assert_eq!(templates.len(), 27);
    let mut a = Adapter::new(&res, &res.join("game-data.json")).unwrap();
    for t in templates {
        let mut config = t.config;
        config["id"] = json!(1);
        let r = a.request(json!({"configs":[config],"hours":1})).unwrap();
        let p = &r["players"][0];
        assert!(
            p["abilities"]
                .as_array()
                .unwrap()
                .iter()
                .all(|a| !a.is_null()),
            "{}",
            t.id
        );
        assert_eq!(p["foodSlots"], 3.);
        assert_eq!(p["drinkSlots"], 3.);
    }
}
#[test]
fn interrupted_job_can_rerun() {
    let res = resource_dir();
    let mut rt = Runtime::new(&res, &res.join("game-data.json"), json!({})).unwrap();
    let cfg = fixture(1, "input")["configs"].as_array().unwrap().clone();
    let stop = Arc::new(AtomicU8::new(1));
    assert!(
        rt.run(cfg.clone(), &Settings::default(), &stop, false)
            .is_err()
    );
    stop.store(0, std::sync::atomic::Ordering::Relaxed);
    let mut s = Settings::default();
    s.hours = 0.01;
    assert!(rt.run(cfg, &s, &stop, false).is_ok());
}
#[test]
fn checkpoint_roundtrip_and_constraints() {
    use lineup_simulator::search::*;
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(resource_dir().join("templates.json")).unwrap())
            .unwrap();
    let mut s = Settings::default();
    s.minimum[6] = 2;
    s.maximum[8] = 0;
    let cp = checkpoint(s, &ts, 5, json!({"engine":"one"}));
    assert!(!cp.pending.is_empty());
    for t in &cp.pending {
        assert!(t.configs.iter().filter(|c| c["name"] == "bow").count() >= 2);
        assert!(!t.configs.iter().any(|c| c["name"] == "shield"));
    }
    let dir = std::env::temp_dir().join(format!("lineup-test-{}.sqlite", std::process::id()));
    let db = lineup_simulator::store::Store::open(&dir).unwrap();
    db.put("checkpoint", &cp.id, &cp).unwrap();
    let restored: Vec<Checkpoint> = db.list("checkpoint").unwrap();
    assert_eq!(restored[0].pending.len(), cp.pending.len());
    drop(db);
    let _ = std::fs::remove_file(dir);
}

#[test]
fn revised_tier_baselines_and_refined_weapons() {
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(resource_dir().join("templates.json")).unwrap())
            .unwrap();
    for t in ts {
        assert!(
            t.config["equipment"]["weapon"]["itemHrid"]
                .as_str()
                .unwrap()
                .ends_with("_refined")
        );
        assert_eq!(
            t.config["equipment"]["weapon"]["enhancementLevel"],
            [12, 14, 15][t.tier]
        );
        for (i, a) in t.config["abilities"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                a["level"],
                if i == 0 {
                    [50, 60, 70][t.tier]
                } else {
                    [80, 90, 100][t.tier]
                }
            );
        }
    }
}
#[test]
fn training_levels_follow_weapon_experience_map() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let data: Value =
        serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
    for t in ts {
        let cfg = &t.config;
        let stats = &data["itemDetailMap"]
            [cfg["equipment"]["weapon"]["itemHrid"].as_str().unwrap()]["equipmentDetail"]["combatStats"];
        let primary = stats["primaryTraining"]
            .as_str()
            .unwrap()
            .rsplit('/')
            .next()
            .unwrap();
        for style in stats["combatStyleHrids"].as_array().unwrap() {
            for skill in data["combatStyleDetailMap"][style.as_str().unwrap()]["skillExpMap"]
                .as_object()
                .unwrap()
                .keys()
            {
                let key = skill.rsplit('/').next().unwrap();
                let expected = if t.profession == "spear" && key == "attack" {
                    145 + 10 * t.tier
                } else if t.profession == "spear" && key == "melee" {
                    140 + 10 * t.tier
                } else if key == primary {
                    150 + 10 * t.tier
                } else {
                    130 + 10 * t.tier
                };
                assert_eq!(cfg["levels"][key], expected, "{} {key}", t.profession);
            }
        }
    }
}
#[test]
fn weapon_observation_counters_and_seed_aggregation() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut rt = Runtime::new(
        &res,
        &res.join("game-data.json"),
        json!({"test":"weapon-counters"}),
    )
    .unwrap();
    let mut reports = vec![];
    for classes in [
        ["water", "fire", "nature", "bow", "crossbow"],
        ["sword", "mace", "spear", "shield", "water"],
    ] {
        let cfg = classes
            .iter()
            .map(|c| {
                ts.iter()
                    .find(|t| t.profession == *c && t.tier == 2)
                    .unwrap()
                    .config
                    .clone()
            })
            .collect();
        let run = rt
            .run(
                cfg,
                &Settings {
                    hours: 1.,
                    ..Settings::default()
                },
                &Arc::new(AtomicU8::new(0)),
                false,
            )
            .unwrap();
        let report = lineup_simulator::analysis::weapon_report(&run);
        for (i, c) in classes.iter().enumerate() {
            let w = &run.result["weaponEffects"][i];
            for (_, v) in w.as_object().unwrap() {
                assert!(v.as_f64().unwrap() >= 0.);
            }
            if *c == "crossbow" {
                assert!(w["pierce_triggers"].as_f64().unwrap() > 0.);
                assert!(
                    w["pierce_damage"].as_f64().unwrap()
                        <= run.metrics.player_dps[i] * run.metrics.hours * 3600.
                );
            }
        }
        let mut combined = run.clone();
        combined.seed_runs = vec![run.clone(), run];
        let twice = lineup_simulator::analysis::weapon_report(&combined);
        assert_eq!(report["players"],twice["players"].clone().as_array().map(|rows|Value::Array(rows.iter().map(|r|{let mut r=r.clone();r["rawCountersTotalAcrossSeeds"]=report["players"][r["slot"].as_u64().unwrap()as usize]["rawCountersTotalAcrossSeeds"].clone();r}).collect())).unwrap());
        reports.push(report);
    }
    std::fs::write(
        "outputs/九职业武器特效观测验证.json",
        serde_json::to_vec_pretty(&reports).unwrap(),
    )
    .unwrap();
}

#[test]
fn retired_monster_cast_replays_the_failed_screen_to_completion() {
    let scenario: Value=serde_json::from_slice(&std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/retired-monster-cast.json")
    ).unwrap()).unwrap();
    let r=run(&scenario);
    assert!(r["simulatedTime"].as_f64().unwrap()>=scenario["simulationTimeLimit"].as_f64().unwrap());
    assert!(r["encounters"].as_f64().unwrap()>0.);
    let mut plain=scenario.clone();plain["observeWeapons"]=json!(false);
    let unobserved=run(&plain);
    for key in ["damageTotals","attacks","dungeonsCompleted","dungeonsFailed","deaths","manaUsed","consumablesUsed","simulatedTime"] {
        assert_eq!(r[key],unobserved[key],"observer changed {key}");
    }
}
