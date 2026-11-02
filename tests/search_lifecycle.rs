use lineup_simulator::{model::*, runtime::*, search::*};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, Ordering},
    },
    time::{Duration, Instant},
};
fn await_status(p: &Arc<Mutex<Progress>>, limit: u64, done: impl Fn(&str) -> bool) {
    let start = Instant::now();
    loop {
        let status = p.lock().unwrap().status.clone();
        if done(&status) {
            return;
        }
        assert!(start.elapsed().as_secs() < limit, "status {status}");
        std::thread::sleep(Duration::from_millis(50));
    }
}
#[test]
fn pause_resume_final_review_and_disk_checkpoint() {
    let res = resource_dir();
    let data = res.join("game-data.json");
    let raw: Value = serde_json::from_slice(&std::fs::read(&data).unwrap()).unwrap();
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let ver = versions(&raw, &ts);
    let mut adapter = Adapter::new(&res, &data).unwrap();
    let catalog = adapter.request(json!({"op":"catalog"})).unwrap();
    let home = std::env::temp_dir().join(format!("lineup-lifecycle-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let mut s = Settings::default();
    s.zone = "/actions/combat/aqua_planet".into();
    s.budget_hours = 0.0001;
    s.workers = 2;
    s.minimum[0] = 1;
    s.minimum[2] = 1;
    s.minimum[6] = 1;
    for i in [1, 3, 4, 5, 7, 8] {
        s.maximum[i] = 0;
    }
    let mut cp = checkpoint(s, &ts, 3, ver);
    assert_eq!(cp.pending.len(), 1);
    cp.pending[0].settings.hours = 2000.;
    let control = Arc::new(AtomicU8::new(0));
    let p = Arc::new(Mutex::new(Progress::default()));
    start(
        cp,
        res.clone(),
        data.clone(),
        home.clone(),
        control.clone(),
        p.clone(),
        catalog.clone(),
    );
    std::thread::sleep(Duration::from_millis(500));
    control.store(1, Ordering::Relaxed);
    await_status(&p, 30, |s| s == "已暂停");
    let cp = p.lock().unwrap().checkpoint.clone().unwrap();
    let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
    let restored: Vec<Checkpoint> = db.list("checkpoint").unwrap();
    assert_eq!(restored[0].pending.len(), cp.pending.len());
    let mut cp = restored[0].clone();
    for t in &mut cp.pending {
        t.settings.hours = 2.;
    }
    control.store(0, Ordering::Relaxed);
    start(
        cp,
        res,
        data,
        home.clone(),
        control.clone(),
        p.clone(),
        catalog,
    );
    await_status(&p, 120, |s| s.starts_with("已完成"));
    let v = p.lock().unwrap();
    assert!(!v.leaders.is_empty());
    assert_eq!(v.leaders[0].seeds.len(), 8);
    assert!(v.leaders[0].metrics.eph > 0.);
    let report = json!({"pauseResume":true,"sqliteCheckpoint":true,"finalSeeds":v.leaders[0].seeds,"ci95":v.leaders[0].ci95,"elapsedSeconds":v.elapsed,"status":v.status});
    std::fs::write(
        "outputs/搜索生命周期验证.json",
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    drop(v);
    drop(db);
    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn crash_worker() {
    let Ok(home) = std::env::var("LINEUP_CRASH_TEST_HOME") else {
        return;
    };
    let res = resource_dir();
    let data = res.join("game-data.json");
    let ts: Vec<Template> =
        serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
    let mut a = Adapter::new(&res, &data).unwrap();
    let catalog = a.request(json!({"op":"catalog"})).unwrap();
    let mut s = Settings::default();
    s.workers = 1;
    s.budget_hours = 0.0001;
    s.fixed = ["nature", "bow", "water"]
        .iter()
        .map(|c| {
            ts.iter()
                .find(|t| t.profession == *c && t.tier == 1)
                .unwrap()
                .config
                .clone()
        })
        .collect();
    s.zone = "/actions/combat/aqua_planet".into();
    let mut cp = checkpoint(s, &ts, 3, json!({"test":"crash"}));
    cp.pending[0].settings.hours = 100_000.;
    start(
        cp,
        res,
        data,
        home.into(),
        Arc::new(AtomicU8::new(0)),
        Arc::new(Mutex::new(Progress::default())),
        catalog,
    );
    loop {
        std::thread::sleep(Duration::from_millis(100));
    }
}
#[test]
fn recover_after_process_kill_and_cancel() {
    let home = std::env::temp_dir().join(format!("lineup-crash-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_worker", "--nocapture"])
        .env("LINEUP_CRASH_TEST_HOME", &home)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let start_time = Instant::now();
    loop {
        if home.join("simulator.sqlite").exists() {
            let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
            if !db
                .list::<Checkpoint>("checkpoint")
                .unwrap_or_default()
                .is_empty()
            {
                break;
            }
        }
        assert!(start_time.elapsed().as_secs() < 15);
        std::thread::sleep(Duration::from_millis(50));
    }
    child.kill().unwrap();
    child.wait().unwrap();
    let db = lineup_simulator::store::Store::open(&home.join("simulator.sqlite")).unwrap();
    let cps: Vec<Checkpoint> = db.list("checkpoint").unwrap();
    assert_eq!(cps.len(), 1);
    assert_eq!(cps[0].pending.len(), 1);
    let res = resource_dir();
    let data = res.join("game-data.json");
    let mut a = Adapter::new(&res, &data).unwrap();
    let catalog = a.request(json!({"op":"catalog"})).unwrap();
    let control = Arc::new(AtomicU8::new(0));
    let p = Arc::new(Mutex::new(Progress::default()));
    let mut cp = cps[0].clone();
    cp.pending[0].settings.hours = 2.;
    start(
        cp,
        res,
        data,
        home.clone(),
        control.clone(),
        p.clone(),
        catalog.clone(),
    );
    await_status(&p, 120, |s| s.starts_with("已完成"));
    let mut cp = (*p.lock().unwrap().checkpoint.clone().unwrap()).clone();
    let leader = cp.leaders[0].clone();
    cp.pending = vec![Task {
        configs: leader.configs,
        settings: Settings {
            hours: 100_000.,
            ..leader.settings
        },
        key: "cancel-test".into(),
    }];
    cp.runs.clear();
    cp.done = 0;
    cp.total = 1;
    cp.status = "运行中".into();
    let q = Arc::new(Mutex::new(Progress::default()));
    start(
        cp,
        resource_dir(),
        resource_dir().join("game-data.json"),
        home.clone(),
        control.clone(),
        q.clone(),
        catalog,
    );
    std::thread::sleep(Duration::from_millis(400));
    control.store(2, Ordering::Relaxed);
    await_status(&q, 15, |s| s == "已取消");
    std::fs::write("outputs/崩溃与取消验证.json",serde_json::to_vec_pretty(&json!({"SIGKILL":true,"sqliteRecovered":true,"resumedToEightSeeds":true,"cooperativeCancel":true})).unwrap()).unwrap();
    drop(db);
    let _ = std::fs::remove_dir_all(home);
}

#[test]
fn old_engine_checkpoint_is_rejected_before_loading_resources() {
    let cp = checkpoint(Settings::default(), &[], 3, json!({"engine":"lineup-rust-0.1.0+20261029.7"}));
    let progress = Arc::new(Mutex::new(Progress::default()));
    start(cp, "/missing/resources".into(), "/missing/data".into(), "/missing/home".into(),
        Arc::new(AtomicU8::new(0)), progress.clone(), json!({}));
    let state=progress.lock().unwrap();
    assert!(state.status.starts_with("失败"));
    assert!(state.error.contains("旧引擎"));
    assert!(state.leaders.is_empty());
}
