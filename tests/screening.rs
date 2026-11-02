use lineup_simulator::{food::*, model::*, store::Store};
use serde_json::{Value, json};
fn config(name: &str) -> Value {
    json!({"name":name,"food":["/items/spaceberry_cake",DONUT,"/items/star_fruit_yogurt"],"drinks":["/items/critical_coffee"],"triggerMap":{},"equipment":{"weapon":{"itemHrid":"/items/cursed_bow_refined"}},"abilities":[{"abilityHrid":"/abilities/precision","level":90}]})
}
fn run(configs: Vec<Value>, oom: Vec<bool>, eph: f64) -> Run {
    let n=configs.len(); Run{id:format!("run-{eph}"), configs, settings:Settings::default(), metrics:Metrics{eph,hours:1.,member_mana_shortage:oom,member_deaths_per_hour:vec![0.;n],player_dps:vec![10.;n],..Default::default()},result:json!({"coffeeAdjustment":{"retained":true}}),versions:json!({}),seeds:vec![42.],ci95:0.,seed_runs:vec![]}
}
fn catalog() -> Value {json!({"items":{GUMMY:{"consumableDetail":{"defaultCombatTriggers":[{"conditionHrid":"/combat_trigger_conditions/missing_mp","value":280}]}}}})}
#[test]
fn only_oom_members_retry_once_and_better_food_survives() {
    let baseline=run(vec![config("water"),config("water"),config("bow")],vec![true,false,true],10.);
    let original=baseline.configs.clone(); let mut calls=0;
    let best=retry_with(baseline,&catalog(),|cfg| {
        calls+=1;
        assert_eq!(cfg[1],original[1]);
        assert_eq!(cfg[0]["drinks"],original[0]["drinks"]);
        assert_eq!(cfg[0]["abilities"],original[0]["abilities"]);
        assert_eq!(cfg[0]["food"][1],GUMMY);
        assert_eq!(cfg[0]["triggerMap"][GUMMY][0]["value"],280);
        if calls==1 {assert_eq!(cfg[2],original[2]);} else {assert_eq!(cfg[2]["food"][1],GUMMY);}
        Ok(run(cfg,vec![false,false,calls==1],10.+calls as f64))
    }).unwrap();
    assert_eq!(calls,2); assert_eq!(best.metrics.eph,12.);
    assert_eq!(best.result["foodAdjustment"]["extraSimulations"],2);
    assert_eq!(best.result["coffeeAdjustment"]["retained"],true);
}
#[test]
fn worse_food_retry_does_not_replace_winner_and_never_loops() {
    let baseline=run(vec![config("sword")],vec![true],10.); let original=baseline.configs.clone(); let mut calls=0;
    let best=retry_with(baseline,&catalog(),|cfg| {calls+=1;Ok(run(cfg,vec![true],9.))}).unwrap();
    assert_eq!(calls,1);assert_eq!(best.configs,original);assert_eq!(best.result["foodAdjustment"]["changes"][0]["accepted"],false);
}
#[test]
fn no_retry_without_oom_or_when_gummy_is_already_present() {
    for (mut c,oom) in [(config("bow"),false),(config("water"),true)] {
        if oom {c["food"][1]=json!(GUMMY);}
        let r=retry_with(run(vec![c],vec![oom],10.),&catalog(),|_|panic!("unnecessary retry")).unwrap();
        assert_eq!(r.result["foodAdjustment"]["extraSimulations"],0);
    }
}
#[test]
fn cancelling_food_retry_propagates_without_fake_result() {
    let r=retry_with(run(vec![config("water")],vec![true],10.),&catalog(),|_|Err(anyhow::anyhow!("interrupted")));
    assert_eq!(r.err().unwrap().to_string(),"interrupted");
}
#[test]
fn selected_food_and_mp_trigger_survive_sqlite_roundtrip() {
    let baseline=run(vec![config("water")],vec![true],10.);
    let best=retry_with(baseline,&catalog(),|cfg|Ok(run(cfg,vec![false],11.))).unwrap();
    let path=std::env::temp_dir().join(format!("food043-{}.sqlite",std::process::id()));
    let db=Store::open(&path).unwrap();db.finite_init().unwrap();
    db.finite_put("food",1,lineup_simulator::finite::Ref{candidate:0,plan:0,ordinal:0},&best).unwrap();
    let payload=db.finite_coffee("food",1,0).unwrap().unwrap();
    let mut configs=vec![config("water")];lineup_simulator::finite::restore_screen_config(&mut configs,&payload,&catalog());
    assert_eq!(configs[0]["food"],best.configs[0]["food"]);assert_eq!(configs[0]["triggerMap"][GUMMY][0]["value"],280);
    assert_eq!(payload["foodAudit"]["changes"][0]["accepted"],true);
    let summary=lineup_simulator::search::thin_rows(&[best]);
    assert_eq!(summary[0].configs[0]["equipment"],configs[0]["equipment"]);
    assert_eq!(summary[0].configs[0]["abilities"],configs[0]["abilities"]);
    drop(db);let _=std::fs::remove_file(path);
}
#[test]
fn per_profession_top50_then_top10_are_deduplicated_not_global() {
    let path=std::env::temp_dir().join(format!("selection043-{}.sqlite",std::process::id()));
    let db=Store::open(&path).unwrap();db.finite_init().unwrap();
    for i in 0..200 {
        let mut cfg=vec![];if i<120 {cfg.push(config("water"));}if i>=100 {cfg.push(config("sword"));}
        let r=run(cfg,vec![],(200-i) as f64);
        db.finite_put("job",1,lineup_simulator::finite::Ref{candidate:i,plan:i,ordinal:0},&r).unwrap();
    }
    let n=db.finite_prepare_profession_selection("job",2,1,50).unwrap();assert_eq!(n,100);
    for pos in 0..n {let id=db.finite_reference("job",2,pos).unwrap();assert!((id.candidate<50)||(100..150).contains(&id.candidate));
        let cfg=if id.candidate<50 {vec![config("water")]}else{vec![config("sword")]};
        db.finite_put("job",2,id,&run(cfg,vec![],(200-id.candidate)as f64)).unwrap();}
    let n=db.finite_prepare_profession_selection("job",3,2,10).unwrap();assert_eq!(n,20);
    let ids=(0..n).map(|p|db.finite_reference("job",3,p).unwrap().candidate).collect::<Vec<_>>();
    assert_eq!(ids,(0..10).chain(100..110).collect::<Vec<_>>());
    drop(db);let _=std::fs::remove_file(path);
}
#[test]
fn policy_is_one_twentyfour_fortyeight_and_old_checkpoint_is_rejected() {
    use lineup_simulator::{search::*,finite::*};use std::sync::{Arc,Mutex,atomic::AtomicU8};
    let mut cp=checkpoint(Settings::default(),&[],3,json!({"engine":ENGINE_VERSION}));
    setup(&mut cp,&json!({}));assert_eq!(cp.finite.as_ref().unwrap().durations,[1.,24.,48.]);assert_eq!(cp.finite.as_ref().unwrap().version,RULES_VERSION);
    cp.finite.as_mut().unwrap().version=3;
    let progress=Arc::new(Mutex::new(Progress::default()));
    lineup_simulator::search::start(cp,"/missing".into(),"/missing".into(),"/missing".into(),Arc::new(AtomicU8::new(0)),progress.clone(),json!({}));
    assert!(progress.lock().unwrap().error.contains("旧版筛选"));
}
