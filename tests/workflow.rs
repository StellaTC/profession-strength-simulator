use lineup_simulator::{model::*, runtime::*, search, store::Store, workflow::*};
use serde_json::{Value, json};
use std::sync::{Arc, atomic::AtomicU8};
fn sample() -> Run {
    Run {
        id: "sample".into(),
        configs: vec![
            json!({"name":"water"}),
            json!({"name":"water"}),
            json!({"name":"bow"}),
        ],
        settings: Settings::default(),
        metrics: Metrics {
            hours: 4.,
            player_dps: vec![10., 20., 30.],
            member_deaths_per_hour: vec![1., 1.25, 0.],
            member_mana_shortage: vec![false, false, true],
            ..Default::default()
        },
        result: json!({}),
        versions: json!({}),
        seeds: vec![],
        ci95: 0.,
        seed_runs: vec![],
    }
}
#[test]
fn member_notes_strict_threshold_and_any_mana() {
    let r = sample();
    assert_eq!(notes(&r), (vec![(1, 1.25)], vec![2]));
    let mut avg = r.clone();
    let mut other = r.clone();
    other.metrics.hours = 12.;
    other.metrics.member_deaths_per_hour = vec![0., 0., 0.];
    other.metrics.member_mana_shortage = vec![false; 3];
    avg.seed_runs = vec![r, other];
    assert!(notes(&avg).0.is_empty());
    assert_eq!(notes(&avg).1, vec![2]);
}
#[test]
fn legacy_notes_use_actual_result() {
    let mut r = sample();
    r.metrics.member_deaths_per_hour.clear();
    r.metrics.member_mana_shortage.clear();
    r.result = json!({"simulatedTime":7200e9,"deaths":{"player1":3,"player2":2},"playerRanOutOfMana":{"player2":true}});
    assert_eq!(notes(&r), (vec![(0, 1.5)], vec![1]));
}
#[test]
fn class_dps_sums_duplicates_and_rank_filters() {
    let r = sample();
    assert_eq!(search::profession_dps(&r, "water"), 30.);
    let mut b = r.clone();
    b.id = "b".into();
    b.metrics.eph = 5.;
    let rows = vec![r, b];
    assert_eq!(top(&rows, 0, false, 10).len(), 2);
    assert_eq!(top(&rows, 0, false, 10)[0].id, "b");
    assert!(top(&rows, 1, false, 10).is_empty());
}
#[test]
fn number_precision_and_zero_comparison() {
    assert_eq!(number(12.), "12");
    assert_eq!(number(12.345), "12.35");
    assert_eq!(number(-0.001), "0");
    assert_eq!(number(10.5), "10.5");
    assert_eq!(change(0., 1.), None);
    assert_eq!(change(10., 12.), Some(20.));
    assert!(planet_allowed("/actions/combat/sorcerers_tower"));
    assert!(!planet_allowed("/actions/combat/novice_sorcerer"));
    assert!(!planet_allowed("/actions/combat/aqua_planet"));
}
#[test]
fn queue_snapshots_order_recovery_and_unlimited_history() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut settings = Settings::default();
    settings.minimum[0] = 3;
    settings.maximum = [0; 9];
    settings.maximum[0] = 3;
    let cp = search::checkpoint(settings, &ts, 3, json!({"engine":ENGINE_VERSION}));
    let item = QueueItem {
        id: "a".into(),
        checkpoint: cp,
        data_file: "snapshot.json".into(),
        catalog: json!({"items":{"custom":{"damage":10.}}}),
        status: QueueStatus::Pending,
        error: String::new(),
    };
    let mut q = Queue {
        items: vec![item.clone(), item],
        enabled: true,
    };
    q.items[1].id = "b".into();
    q.move_item(0, 1);
    assert_eq!(q.items[0].id, "b");
    q.items[0].checkpoint.settings.tier = 5;
    assert_eq!(q.items[1].checkpoint.settings.tier, 1);
    q.items[0].status = QueueStatus::Running;
    q.items[1].status = QueueStatus::Completed;
    q.recover();
    assert_eq!(q.items[0].status, QueueStatus::Paused);
    assert!(!q.enabled);
    assert_eq!(q.next(), None);
    let dir = std::env::temp_dir().join(format!("strength-queue-{}.sqlite", std::process::id()));
    let db = Store::open(&dir).unwrap();
    db.put("queue", "active", &q).unwrap();
    let restored: Queue = db.get("queue", "active").unwrap().unwrap();
    assert_eq!(restored.items[1].status, QueueStatus::Completed);
    for i in 0..40 {
        db.put("history-test", &i.to_string(), &i).unwrap();
    }
    assert_eq!(db.list::<u32>("history-test").unwrap().len(), 40);
    drop(db);
    let _ = std::fs::remove_file(dir);
}
#[test]
fn observations_are_rng_neutral_and_no_effect_no_rows() {
    let res = resource_dir();
    let input: Value =
        serde_json::from_slice(&std::fs::read("tests/fixtures/team-1-input.json").unwrap())
            .unwrap();
    let gdv: Value =
        serde_json::from_slice(&std::fs::read(res.join("native-game-data.json")).unwrap()).unwrap();
    let gd = mwi_engine::data::GameData::from_json(&gdv).unwrap();
    let mut outputs = vec![];
    for observe in [false, true] {
        let mut sc = input["scenario"].clone();
        sc["observeWeapons"] = json!(observe);
        let mut sim = mwi_engine::sim::Sim::new(&gd, &sc, true).unwrap();
        sim.simulate(3600e9).unwrap();
        outputs.push(sim.result_json());
    }
    for key in [
        "attacks",
        "deaths",
        "manaUsed",
        "dungeonsCompleted",
        "dungeonsFailed",
        "simulatedTime",
    ] {
        assert_eq!(outputs[0][key], outputs[1][key], "{key}");
    }
    let mut run = sample();
    run.result = json!({"compiledScenario":{"players":[{"equipStats":{}},{"equipStats":{}},{"equipStats":{}}]}});
    assert!(
        lineup_simulator::analysis::weapon_report(&run)["players"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[test]
fn custom_item_can_add_and_remove_combat_stats() {
    let res = resource_dir();
    let raw: Value =
        serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
    let mut data = raw.clone();
    let source = "/items/cursed_bow_refined";
    let id = "/items/cursed_bow_refined__strength_test";
    data["itemDetailMap"][id] = data["itemDetailMap"][source].clone();
    data["itemDetailMap"][id]["hrid"] = json!(id);
    data["itemDetailMap"][id]["name"] = json!("自定义测试弓");
    let stats = data["itemDetailMap"][id]["equipmentDetail"]["combatStats"]
        .as_object_mut()
        .unwrap();
    stats.remove("curse");
    stats.insert("blaze".into(), json!(0.5));
    let file = std::env::temp_dir().join(format!("strength-item-{}.json", std::process::id()));
    std::fs::write(&file, serde_json::to_vec(&data).unwrap()).unwrap();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut c = ts
        .iter()
        .find(|t| t.profession == "bow" && t.tier == 1)
        .unwrap()
        .config
        .clone();
    c["equipment"]["weapon"]["itemHrid"] = json!(id);
    let mut rt = Runtime::new(&res, &file, json!({})).unwrap();
    let run = rt
        .run(
            vec![c],
            &Settings {
                hours: 0.05,
                ..Default::default()
            },
            &Arc::new(AtomicU8::new(0)),
            true,
        )
        .unwrap();
    let report = lineup_simulator::analysis::weapon_report(&run);
    let effects = report["players"][0]["effects"].as_array().unwrap();
    assert!(effects.iter().any(|e| e["key"] == "blaze"));
    assert!(!effects.iter().any(|e| e["key"] == "curse"));
    assert_eq!(run.result["equipmentSnapshot"][id]["name"], "自定义测试弓");
    let _ = std::fs::remove_file(file);
}
#[test]
fn report_index_discovers_old_app_completion_in_same_second() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut s = Settings::default();
    s.minimum[0] = 3;
    s.maximum = [0; 9];
    s.maximum[0] = 3;
    let mut cp = search::checkpoint(s, &ts, 3, json!({}));
    cp.comparison = true;
    cp.status = "运行中".into();
    let dir = std::env::temp_dir().join(format!("strength-index-{}.sqlite", std::process::id()));
    let db = Store::open(&dir).unwrap();
    db.put("checkpoint", &cp.id, &cp).unwrap();
    assert!(!sync_report_index(&db).unwrap()[0].complete());
    let mut r = sample();
    r.id = "finished-run".into();
    db.put("run", &r.id, &r).unwrap();
    db.put("comparison", &cp.id, &search::thin_rows(&[r]))
        .unwrap();
    cp.status = "比较完成".into();
    db.put("checkpoint", &cp.id, &cp).unwrap();
    let reports = sync_report_index(&db).unwrap();
    assert!(reports[0].complete());
    assert_eq!(reports[0].runs, vec!["finished-run"]);
    assert_eq!(reports[0].load(&db).len(), 1);
    drop(db);
    let _ = std::fs::remove_file(dir);
}
#[test]
fn v2_weapon_statistics_complete_cycles_and_phase_totals() {
    let res = resource_dir();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let configs = ["water", "sword", "spear", "shield", "nature"]
        .iter()
        .map(|c| {
            ts.iter()
                .find(|t| t.profession == *c && t.tier == 2)
                .unwrap()
                .config
                .clone()
        })
        .collect();
    let mut rt = Runtime::new(
        &res,
        &res.join("game-data.json"),
        json!({"engine":ENGINE_VERSION}),
    )
    .unwrap();
    let run = rt
        .run(
            configs,
            &Settings {
                hours: 0.2,
                ..Default::default()
            },
            &Arc::new(AtomicU8::new(0)),
            true,
        )
        .unwrap();
    assert_eq!(run.result["weaponObservationVersion"], 2);
    let w = &run.result["weaponEffects"];
    assert!(w[2]["fury_bonus_damage"].as_f64().unwrap() > 0.);
    assert!(w[1]["parry_prevented"].as_f64().unwrap() > 0.);
    assert!(w[3]["weaken_prevented"].as_f64().unwrap() > 0.);
    assert!(w[4]["bloom_attempted"].as_f64().unwrap() >= w[4]["bloom_healing"].as_f64().unwrap());
    let cycles: Vec<_> = run.result["rippleCooldowns"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|rows| rows.as_array().unwrap().iter())
        .collect();
    assert!(!cycles.is_empty());
    for c in cycles {
        assert!(c["seconds"].as_f64().unwrap() > 0.);
        assert!(c["seconds"].as_f64().unwrap() <= c["originalSeconds"].as_f64().unwrap());
        assert!(c["count"].as_f64().unwrap() > 0.);
    }
    for i in 0..5 {
        for (k, v) in w[i].as_object().unwrap() {
            let phase = run.result["phaseWeaponEffects"]
                .as_object()
                .unwrap()
                .values()
                .map(|rows| rows[i][k].as_f64().unwrap())
                .sum::<f64>();
            assert!((phase - v.as_f64().unwrap()).abs() < 1e-4, "{i} {k}");
        }
    }
    std::fs::write(
        "outputs/新版武器观测验证.json",
        serde_json::to_vec_pretty(&lineup_simulator::analysis::weapon_report(&run)).unwrap(),
    )
    .unwrap();
}

#[test]
fn cast_fix_restart_preserves_snapshot_and_isolates_old_results() {
 use lineup_simulator::{search,workflow::*,model::*};
 let res=lineup_simulator::runtime::resource_dir();
 let ts:Vec<Template>=serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
 let mut adapter=lineup_simulator::runtime::Adapter::new(&res,&res.join("game-data.json")).unwrap();
 let cat=adapter.request(serde_json::json!({"op":"catalog"})).unwrap();
 let mut cp=search::comparison_checkpoint(Settings::default(),&ts,3,serde_json::json!({"engine":"lineup-rust-0.1.0+20261029.8","templatesHash":"original"}),&cat);
 cp.finite.as_mut().unwrap().stage=2;cp.finite.as_mut().unwrap().cursor=123;cp.done=123;cp.elapsed=90.;cp.errors.push("allies list missing".into());
 let item=QueueItem{id:cp.id.clone(),checkpoint:cp,data_file:"snapshot.json".into(),catalog:cat,status:QueueStatus::Paused,error:"allies list missing".into()};
 let before=serde_json::to_value(&item).unwrap();
 let new=restart_after_cast_fix(&item,"new-engine-job".into()).unwrap();
 assert_eq!(serde_json::to_value(&item).unwrap(),before);
 assert_eq!(new.checkpoint.versions["engine"],ENGINE_VERSION);
 assert_eq!(new.checkpoint.versions["templatesHash"],"original");
 assert_eq!(new.data_file,item.data_file);assert_eq!(new.catalog,item.catalog);
 assert_eq!(serde_json::to_value(&new.checkpoint.finite.as_ref().unwrap().plans).unwrap(),before["checkpoint"]["finite"]["plans"]);
 assert_eq!(new.checkpoint.settings.seed,item.checkpoint.settings.seed);
 assert_eq!(new.checkpoint.finite.as_ref().unwrap().cursor,0);assert_eq!(new.checkpoint.finite.as_ref().unwrap().stage,0);
 assert!(new.checkpoint.runs.is_empty()&&new.checkpoint.leaders.is_empty()&&new.checkpoint.errors.is_empty());
 assert_ne!(new.id,item.id);
 assert!(restart_after_cast_fix(&new,"again".into()).is_none());
 let mut completed=item;completed.status=QueueStatus::Completed;
 assert!(restart_after_cast_fix(&completed,"again".into()).is_none());
}
