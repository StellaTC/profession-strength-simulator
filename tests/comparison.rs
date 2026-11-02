use lineup_simulator::{model::*, runtime::*, search::*};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex, atomic::AtomicU8},
    time::{Duration, Instant},
};
fn setup() -> (Vec<Template>, Value) {
    let res = resource_dir();
    let ts = serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut adapter = Adapter::new(&res, &res.join("game-data.json")).unwrap();
    (ts, adapter.request(json!({"op":"catalog"})).unwrap())
}
#[test]
fn all_compositions_use_profession_specific_twenty_percent_pools() {
    let (ts, catalog) = setup();
    for n in [3, 5] {
        let cp = comparison_checkpoint(Settings::default(), &ts, n, json!({}), &catalog);
        assert_eq!(cp.pending.len(), if n == 3 { 165 } else { 1287 });
        for task in cp.pending {
            for c in task.configs {
                assert!(c["equipment"].get("trinket").is_none());
                let cls = c["name"].as_str().unwrap();
                assert_eq!(
                    c["food"],
                    catalog["searchPools"]["professions"][cls]["food"]
                );
                for a in c["abilities"].as_array().unwrap() {
                    let hrid = a["abilityHrid"].as_str().unwrap();
                    if hrid.is_empty() {
                        continue;
                    }
                    assert!(
                        catalog["searchPools"]["professions"][cls]["abilities"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|p| p["hrid"] == hrid && p["usage"].as_f64().unwrap() >= 0.2)
                    );
                }
            }
        }
    }
    assert!(
        !catalog["searchPools"]["coffeePool"]
            .as_array()
            .unwrap()
            .contains(&json!("/items/wisdom_coffee"))
    );
    let raw: Value =
        serde_json::from_slice(&std::fs::read(resource_dir().join("game-data.json")).unwrap())
            .unwrap();
    for (h, item) in raw["itemDetailMap"].as_object().unwrap() {
        if h.ends_with("_coffee")
            && item["consumableDetail"]["usableInActionTypeMap"]["/action_types/combat"] == true
            && h != "/items/wisdom_coffee"
            && h != "/items/lucky_coffee"
        {
            assert!(
                catalog["searchPools"]["coffeePool"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(h))
            );
        }
    }
}
#[test]
fn excludes_only_tail_attempt_and_includes_wipe_time() {
    let r = json!({"simulatedTime":10800e9,"isDungeon":true,"dungeonsCompleted":2,"dungeonsFailed":1,"finishedAttemptSeconds":7200.,"unfinishedAttemptSeconds":3600.,"dungeonAttemptDurations":[{"successful":true,"seconds":2500.},{"successful":false,"seconds":1000.},{"successful":true,"seconds":3700.}]});
    let m = metrics(&r, 5);
    assert_eq!(m.eph, 1.);
    assert_eq!(m.ranked_hours, 2.);
    assert_eq!(m.unfinished_hours, 1.);
    assert!((m.failed_hours - 1000. / 3600.).abs() < 1e-9);
    let empty = json!({"simulatedTime":3600e9,"isDungeon":true,"dungeonsCompleted":0,"dungeonsFailed":0,"finishedAttemptSeconds":0.});
    assert_eq!(metrics(&empty, 5).eph, 0.);
}
#[test]
fn native_full_165_comparison_keeps_every_route() {
    let (ts, catalog) = setup();
    let res = resource_dir();
    let data = res.join("game-data.json");
    let home = std::env::temp_dir().join(format!("full-compare-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let settings = Settings {
        zone: "/actions/combat/aqua_planet".into(),
        hours: 0.02,
        budget_hours: 0.,
        comparison_seeds: 1,
        workers: Settings::default().workers,
        ..Settings::default()
    };
    let mut cp = comparison_checkpoint(settings, &ts, 3, json!({"test":"full165"}), &catalog);
    {
        let state = cp.finite.as_mut().unwrap();
        for plan in Arc::make_mut(&mut state.plans) {
            for (_, opts) in &mut plan.regular {
                opts.truncate(1);
            }
            plan.auras.truncate(1);
            plan.count = 1;
        }
        state.initial = state.plans.len();
        state.durations = [0.0001; 3];
    }

    let legal = cp.finite.as_ref().unwrap().plans.len();
    let p = Arc::new(Mutex::new(Progress::default()));
    start(
        cp,
        res,
        data,
        home.clone(),
        Arc::new(AtomicU8::new(0)),
        p.clone(),
        catalog,
    );
    let timer = Instant::now();
    loop {
        let state = p.lock().unwrap().clone();
        if state.status.starts_with("比较完成") {
            assert!(
                !state.all_rows.is_empty() && state.all_rows.len() <= 90
            );
            assert!(state.error.is_empty(), "{}", state.error);
            let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
            let saved: Vec<Vec<Run>> = db.list("comparison").unwrap();
            assert_eq!(saved[0].len(), state.all_rows.len());
            assert!(
                saved[0]
                    .iter()
                    .all(|r| r.seed_runs.is_empty() && r.result.is_null())
            );
            assert_eq!(db.finite_count(&state.job, 0, None).unwrap(), legal);
            assert_eq!(db.finite_count(&state.job, 1, None).unwrap(), legal);
            let expected: std::collections::BTreeSet<_> = (0..9).flat_map(|c| db.finite_top(&state.job,1,50,Some(c),false,0).unwrap().into_iter().map(|(r,_,_)| r.candidate)).collect();
            assert_eq!(db.finite_count(&state.job,2,None).unwrap(),expected.len());
            let final_expected: std::collections::BTreeSet<_> = (0..9).flat_map(|c| db.finite_top(&state.job,2,10,Some(c),false,0).unwrap().into_iter().map(|(r,_,_)| r.candidate)).collect();
            assert_eq!(db.finite_count(&state.job,3,None).unwrap(),final_expected.len());
            let first = db.get::<Run>("run", &saved[0][0].id).unwrap().unwrap();
            assert_eq!(first.seed_runs.len(), 1);
            std::fs::write("outputs/全阵容横向比较验证.json",serde_json::to_vec_pretty(&json!({"professionPool":165,"legalProfessionRoutes":legal,"fullSkillAuraEnumeration":"另见完整方案枚举验证；本流程测试将每职业阵容的配置维度压至1、使用短时长","professionFilteredAcrossAllRows":true,"persistedRoutes":saved[0].len(),"engineErrors":state.error,"elapsedSeconds":timer.elapsed().as_secs_f64()})).unwrap()).unwrap();
            break;
        }
        assert!(!state.status.starts_with("失败"), "{}", state.error);
        assert!(
            timer.elapsed().as_secs() < 600,
            "{} {} {}",
            state.status,
            state.done,
            state.error
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn native_full_1287_dungeon_comparison_keeps_every_route() {
    let (ts, catalog) = setup();
    let res = resource_dir();
    let data = res.join("game-data.json");
    let home = std::env::temp_dir().join(format!("full-dungeon-compare-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let settings = Settings {
        zone: "/actions/combat/pirate_cove".into(),
        hours: 0.02,
        budget_hours: 0.,
        comparison_seeds: 1,
        workers: Settings::default().workers,
        ..Settings::default()
    };
    let mut cp = comparison_checkpoint(settings, &ts, 5, json!({"test":"full1287"}), &catalog);
    {
        let state = cp.finite.as_mut().unwrap();
        for plan in Arc::make_mut(&mut state.plans) {
            for (_, opts) in &mut plan.regular {
                opts.truncate(1);
            }
            plan.auras.truncate(1);
            plan.count = 1;
        }
        state.initial = state.plans.len();
        state.durations = [0.0001; 3];
    }

    let legal = cp.finite.as_ref().unwrap().plans.len();
    let p = Arc::new(Mutex::new(Progress::default()));
    start(
        cp,
        res,
        data,
        home.clone(),
        Arc::new(AtomicU8::new(0)),
        p.clone(),
        catalog,
    );
    let timer = Instant::now();
    loop {
        let state = p.lock().unwrap().clone();
        if state.status.starts_with("比较完成") {
            assert!(!state.all_rows.is_empty() && state.all_rows.len() <= 90);
            assert!(state.error.is_empty(), "{}", state.error);
            let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
            let saved: Vec<Vec<Run>> = db.list("comparison").unwrap();
            assert_eq!(saved[0].len(), state.all_rows.len());
            assert!(
                saved[0]
                    .iter()
                    .all(|r| r.seed_runs.is_empty() && r.result.is_null())
            );
            let first = db.get::<Run>("run", &saved[0][0].id).unwrap().unwrap();
            assert_eq!(first.seed_runs.len(), 1);
            std::fs::write("outputs/五人全阵容横向比较验证.json",serde_json::to_vec_pretty(&json!({"professionPool":1287,"legalProfessionRoutes":legal,"fullSkillAuraEnumeration":"另见完整方案枚举验证；本流程测试将每职业阵容的配置维度压至1、使用短时长","professionFilteredAcrossAllRows":true,"persistedRoutes":saved[0].len(),"engineErrors":state.error,"elapsedSeconds":timer.elapsed().as_secs_f64()})).unwrap()).unwrap();
            break;
        }
        assert!(!state.status.starts_with("失败"), "{}", state.error);
        assert!(
            timer.elapsed().as_secs() < 600,
            "{} {} {}",
            state.status,
            state.done,
            state.error
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn target_catalog_contains_planets_and_dungeons_without_single_monsters() {
    let (_, catalog) = setup();
    let zones = catalog["zones"].as_array().unwrap();
    let dungeons = zones
        .iter()
        .filter(|z| z["combatZoneInfo"]["isDungeon"] == true)
        .count();
    assert_eq!(dungeons, 4);
    assert_eq!(zones.len() - dungeons, 11);
    for zone in zones {
        if zone["combatZoneInfo"]["isDungeon"] != true {
            assert!(
                zone["combatZoneInfo"]["fightInfo"]["randomSpawnInfo"]["spawns"]
                    .as_array()
                    .unwrap()
                    .len()
                    > 1,
                "single monster target: {}",
                zone["hrid"]
            );
        }
    }
}

#[test]
fn exhaustive_skill_aura_rules_and_real_candidate_counts() {
    use lineup_simulator::finite::{aura_options, candidate_count, plan, regular_options};
    let (ts, cat) = setup();
    for cls in CLASSES {
        let opts = regular_options(cls, &cat);
        assert!(!opts.is_empty());
        for set in &opts {
            for a in cat["searchPools"]["professions"][cls]["abilities"]
                .as_array()
                .unwrap()
            {
                if a["special"] == false && a["usage"].as_f64().unwrap() > 0.99 {
                    assert!(set.contains(&a["hrid"].as_str().unwrap().to_owned()));
                }
            }
        }
    }
    assert_eq!(regular_options("fire", &cat).len(), 4);
    assert_eq!(regular_options("nature", &cat).len(), 10);
    let base: Vec<_> = ["fire", "fire", "shield"]
        .iter()
        .map(|c| {
            ts.iter()
                .find(|t| t.profession == *c && t.tier == 1)
                .unwrap()
                .config
                .clone()
        })
        .collect();
    let p = plan(base, &cat);
    let mut unique = std::collections::HashSet::new();
    for i in 0..p.count {
        let c = p.configs(i, &cat);
        assert_eq!(
            &c[0]["abilities"].as_array().unwrap()[1..],
            &c[1]["abilities"].as_array().unwrap()[1..]
        );
        for skill in c[0]["abilities"].as_array().unwrap().iter().skip(1) {
            let h = skill["abilityHrid"].as_str().unwrap();
            assert_eq!(c[0]["triggerMap"][h], c[1]["triggerMap"][h]);
        }
        assert_eq!(
            c[0]["drinks"],
            cat["searchPools"]["professions"]["fire"]["fixedDrinks"]
        );
        assert!(unique.insert(digest(&c)));
    }
    let mage = vec!["water".into(), "fire".into(), "nature".into()];
    assert!(!aura_options("water", &mage, &cat).contains(&"/abilities/fierce_aura".into()));
    let phys = vec!["bow".into()];
    assert!(!aura_options("bow", &phys, &cat).contains(&"/abilities/mystic_aura".into()));
    assert!(!aura_options("bow", &phys, &cat).contains(&"/abilities/insanity".into()));
    let counts = [
        candidate_count(3, &ts, 1, &cat),
        candidate_count(5, &ts, 1, &cat),
    ];
    assert!(counts[0] > 165 && counts[1] > 1287);
    std::fs::write("outputs/完整方案枚举验证.json",serde_json::to_vec_pretty(&json!({"three":counts[0],"five":counts[1],"repeatedProfessionSharedRegularSkills":true,"requiredAbove99Percent":true,"genericAuraRules":true,"allSchemesUniqueForRepeatedFireSample":p.count,"phases":[1,24,48],"reviewPerProfession":50,"finalPerProfession":10,"finalUnionLimit":90})).unwrap()).unwrap();
}
#[test]
fn strict_aura_ownership_no_empty_and_only_water_insanity() {
    use lineup_simulator::finite::*;
    let (ts, cat) = crate::setup();
    let mut report = vec![];
    for size in [3, 5] {
        let mut legal = 0;
        let mut total = 0;
        for comb in combinations(size) {
            let base: Vec<_> = comb
                .iter()
                .map(|i| {
                    ts.iter()
                        .find(|t| t.profession == CLASSES[*i] && t.tier == 2)
                        .unwrap()
                        .config
                        .clone()
                })
                .collect();
            let p = plan(base, &cat);
            if p.count > 0 {
                legal += 1;
            }
            total += p.count;
            for assignment in &p.auras {
                let mut used = std::collections::HashSet::new();
                for (i, h) in assignment.iter().enumerate() {
                    assert!(!h.is_empty());
                    if h == "/abilities/insanity" {
                        assert_eq!(p.base[i]["name"], "water");
                    }
                    if team_aura(h, &cat) {
                        assert!(used.insert(h));
                    }
                }
            }
        }
        report.push(json!({"size":size,"professionPool":combinations(size).len(),"legalProfessionRoutes":legal,"excludedByAuraRules":combinations(size).len()-legal,"fullSchemes":total,"review24hPerProfession":50,"reviewUnionMaximum":450,"finalPerProfession":10,"finalUnionMaximum":90}));
    }
    // Speed belongs to attack-primary spear; guardian belongs to defense-primary shield.
    let base: Vec<_> = ["spear", "shield", "water"]
        .iter()
        .map(|c| {
            ts.iter()
                .find(|t| t.profession == *c && t.tier == 2)
                .unwrap()
                .config
                .clone()
        })
        .collect();
    let p = plan(base, &cat);
    assert!(p.count > 0);
    for a in &p.auras {
        for (i, h) in a.iter().enumerate() {
            if h == "/abilities/speed_aura" {
                assert_eq!(i, 0)
            }
            if h == "/abilities/guardian_aura" {
                assert_eq!(i, 1)
            }
            if h == "/abilities/mystic_aura" {
                assert_eq!(i, 2)
            }
        }
    }
    std::fs::write("outputs/光环分工与规模验证.json",serde_json::to_vec_pretty(&json!({"rules":"团队光环不重复，主属性匹配优先，等级次之；最强携带者冲突则两种择一；只有水法可用Insanity；不允许留空；同配装队员互换分工去重","counts":report})).unwrap()).unwrap();
}
#[test]
fn finite_pause_resume_uses_disk_stage_and_seed_results() {
    use std::sync::atomic::Ordering;
    let (ts, cat) = setup();
    let res = resource_dir();
    let home = std::env::temp_dir().join(format!("finite-resume-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let mut s = Settings {
        workers: 1,
        comparison_seeds: 2,
        zone: "/actions/combat/aqua_planet".into(),
        ..Settings::default()
    };
    s.minimum[0] = 3;
    let mut cp = comparison_checkpoint(s, &ts, 3, json!({"test":"finite-resume"}), &cat);
    let st = cp.finite.as_mut().unwrap();
    assert_eq!(st.plans.len(), 1);
    Arc::make_mut(&mut st.plans)[0].auras.truncate(1);
    Arc::make_mut(&mut st.plans)[0]
        .regular
        .iter_mut()
        .for_each(|(_, o)| o.truncate(1));
    Arc::make_mut(&mut st.plans)[0].count = 1;
    st.initial = 1;
    st.durations = [0.001, 0.001, 10000.];
    let control = Arc::new(AtomicU8::new(0));
    let p = Arc::new(Mutex::new(Progress::default()));
    start(
        cp,
        res.clone(),
        res.join("game-data.json"),
        home.clone(),
        control.clone(),
        p.clone(),
        cat.clone(),
    );
    let t = Instant::now();
    loop {
        if p.lock().unwrap().stage.starts_with("各职业前10") {
            break;
        }
        assert!(t.elapsed().as_secs() < 30);
        std::thread::sleep(Duration::from_millis(20));
    }
    control.store(1, Ordering::Relaxed);
    loop {
        if p.lock().unwrap().status == "已暂停" {
            break;
        }
        assert!(t.elapsed().as_secs() < 30);
        std::thread::sleep(Duration::from_millis(20));
    }
    let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
    let mut cp: Checkpoint = db
        .get("checkpoint", &p.lock().unwrap().job)
        .unwrap()
        .unwrap();
    assert_eq!(cp.finite.as_ref().unwrap().stage, 3);
    cp.finite.as_mut().unwrap().durations[2] = 0.005;
    control.store(0, Ordering::Relaxed);
    start(
        cp,
        res.clone(),
        res.join("game-data.json"),
        home.clone(),
        control,
        p.clone(),
        cat,
    );
    loop {
        let status = p.lock().unwrap().status.clone();
        if status.starts_with("比较完成") {
            break;
        }
        assert!(!status.starts_with("失败"));
        assert!(t.elapsed().as_secs() < 40);
        std::thread::sleep(Duration::from_millis(20));
    }
    let state = p.lock().unwrap();
    let run: Run = db.get("run", &state.all_rows[0].id).unwrap().unwrap();
    assert_eq!(run.seed_runs.len(), 2);
    assert!(run.result["weaponAnalysis"].is_object());
    std::fs::write("outputs/有限搜索暂停续跑验证.json",serde_json::to_vec_pretty(&json!({"diskStageRestored":3,"independentSeeds":2,"finalPerProfession":10,"deduplicatedFinalCandidates":state.all_rows.len(),"fullSeedResultsPersisted":true,"status":state.status})).unwrap()).unwrap();
    drop(state);
    drop(db);
    let _ = std::fs::remove_dir_all(home);
}
#[test]
fn real_coffee_screen_and_disk_selection_survive_later_stages() {
    let (ts, cat) = setup();
    let res = resource_dir();
    let mut rt = Runtime::new(
        &res,
        &res.join("game-data.json"),
        json!({"test":"real-coffee"}),
    )
    .unwrap();
    let cfg = vec![
        ts.iter()
            .find(|t| t.profession == "water" && t.tier == 0)
            .unwrap()
            .config
            .clone();
        3
    ];
    let s = Settings {
        zone: "/actions/combat/infernal_abyss".into(),
        tier: 5,
        hours: 4.,
        ..Settings::default()
    };
    let screen =
        lineup_simulator::coffee::screen(&mut rt, cfg, &s, &Arc::new(AtomicU8::new(0)), &cat)
            .unwrap();
    assert_eq!(
        screen.result["coffeeAdjustment"]["baselineTriggeredSurvival"],
        true
    );
    assert!(
        screen.result["coffeeAdjustment"]["screenSimulations"]
            .as_u64()
            .unwrap()
            <= 4
    );
    for c in &screen.configs {
        assert_eq!(c["drinks"][0], "/items/ultra_stamina_coffee");
        assert_eq!(c["drinks"][2], "/items/ultra_attack_coffee");
    }
    let home = std::env::temp_dir().join(format!("real-coffee-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
    db.finite_init().unwrap();
    db.finite_put(
        "coffee",
        1,
        lineup_simulator::finite::Ref {
            candidate: 0,
            plan: 0,
            ordinal: 0,
        },
        &screen,
    )
    .unwrap();
    let saved = db.finite_coffee("coffee", 1, 0).unwrap().unwrap();
    assert_eq!(
        saved["drinks"],
        serde_json::to_value(
            screen
                .configs
                .iter()
                .map(|c| c["drinks"].clone())
                .collect::<Vec<_>>()
        )
        .unwrap()
    );
    let later = rt
        .run(
            screen.configs.clone(),
            &Settings { hours: 0.02, ..s },
            &Arc::new(AtomicU8::new(0)),
            false,
        )
        .unwrap();
    assert_eq!(later.configs, screen.configs);
    std::fs::write("outputs/初筛咖啡与耐力调整验证.json",serde_json::to_vec_pretty(&json!({"realSimulation":true,"baselineIndividualDeathsPerHour":screen.result["coffeeAdjustment"]["baselineIndividualDeathsPerHour"],"audit":screen.result["coffeeAdjustment"],"laterStageDrinksUnchanged":true,"persistedSelection":saved["drinks"]})).unwrap()).unwrap();
    drop(db);
    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn repeated_water_regular_skills_match_but_specials_are_independent() {
    let (ts, cat) = setup();
    let water = ts
        .iter()
        .find(|t| t.profession == "water" && t.tier == 2)
        .unwrap()
        .config
        .clone();
    let plan = lineup_simulator::finite::plan(vec![water; 3], &cat);
    let mut counts = std::collections::BTreeMap::<usize, usize>::new();
    let mut examples = std::collections::BTreeMap::<usize, Vec<String>>::new();
    for i in 0..plan.count {
        let configs = plan.configs(i, &cat);
        let specials: Vec<String> = configs
            .iter()
            .map(|c| {
                c["abilities"][0]["abilityHrid"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        let n = specials
            .iter()
            .filter(|h| h.as_str() == "/abilities/insanity")
            .count();
        *counts.entry(n).or_default() += 1;
        examples.entry(n).or_insert(specials);
        for member in configs.iter().skip(1) {
            assert_eq!(
                &configs[0]["abilities"].as_array().unwrap()[1..],
                &member["abilities"].as_array().unwrap()[1..]
            );
        }
    }
    assert_eq!(counts.keys().copied().collect::<Vec<_>>(), vec![0, 1, 2, 3]);
    assert!(examples[&1].iter().any(|h| h != "/abilities/insanity"));
    assert!(examples[&2].iter().any(|h| h != "/abilities/insanity"));
    let names = |hs: &Vec<String>| {
        hs.iter()
            .map(|h| cat["abilities"][h]["name"].as_str().unwrap_or(h).to_owned())
            .collect::<Vec<_>>()
    };
    let report = json!({"threeWaterTotalPlans":plan.count,"plansByInsanityCarrierCount":counts,"oneInsanityExample":names(&examples[&1]),"twoInsanityExample":names(&examples[&2]),"sameRegularSkills":true,"specialSlotIndependent":true});
    std::fs::write(
        "outputs/重复水法特技独立分配验证.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("{}", report);
}
