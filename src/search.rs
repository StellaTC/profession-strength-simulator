use crate::{model::*, runtime::Runtime, store::Store};
use rand::{Rng, SeedableRng, rngs::StdRng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, AtomicUsize, Ordering},
    },
    time::Instant,
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Task {
    pub configs: Vec<Value>,
    pub settings: Settings,
    pub key: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub versions: Value,
    pub settings: Settings,
    pub stage: String,
    pub elapsed: f64,
    pub round: u64,
    pub pending: Vec<Task>,
    pub runs: Vec<Run>,
    pub leaders: Vec<Run>,
    pub errors: Vec<String>,
    pub status: String,
    pub done: usize,
    pub total: usize,
    #[serde(default)]
    pub comparison: bool,
    #[serde(default)]
    pub finite: Option<crate::finite::State>,
    #[serde(default)]
    pub composition_best: Vec<Run>,
}
#[derive(Clone, Default)]
pub struct Progress {
    pub status: String,
    pub stage: String,
    pub done: usize,
    pub total: usize,
    pub elapsed: f64,
    pub leaders: Vec<Run>,
    pub error: String,
    pub checkpoint: Option<Arc<Checkpoint>>,
    pub all_rows: Arc<Vec<Run>>,
    pub rows_round: u64,
    pub job: String,
    pub initial_candidates: usize,
    pub profession_routes: usize,
}
pub const POOLS: [&[&str]; 9] = [
    &[
        "elemental_affinity",
        "frost_surge",
        "mana_spring",
        "water_strike",
        "precision",
        "ice_spear",
    ],
    &[
        "elemental_affinity",
        "smoke_burst",
        "firestorm",
        "flame_blast",
        "fireball",
        "precision",
    ],
    &[
        "elemental_affinity",
        "toxic_pollen",
        "natures_veil",
        "life_drain",
        "entangle",
        "quick_aid",
        "rejuvenate",
        "precision",
    ],
    &[
        "frenzy",
        "berserk",
        "precision",
        "maim",
        "crippling_slash",
        "cleave",
        "vampirism",
    ],
    &[
        "frenzy",
        "berserk",
        "precision",
        "fracturing_impact",
        "stunning_blow",
        "sweep",
        "vampirism",
    ],
    &[
        "frenzy",
        "berserk",
        "precision",
        "puncture",
        "penetrating_strike",
        "vampirism",
    ],
    &[
        "frenzy",
        "berserk",
        "precision",
        "rain_of_arrows",
        "steady_shot",
        "pestilent_shot",
        "penetrating_shot",
        "vampirism",
    ],
    &[
        "frenzy",
        "berserk",
        "precision",
        "rain_of_arrows",
        "steady_shot",
        "pestilent_shot",
        "penetrating_shot",
        "vampirism",
    ],
    &[
        "provoke",
        "elusiveness",
        "toughness",
        "spike_shell",
        "retribution",
        "fracturing_impact",
        "shield_bash",
    ],
];
pub fn tasks(settings: &Settings, templates: &[Template], size: usize) -> Vec<Task> {
    if settings.fixed.len() > size {
        return vec![];
    }
    combinations(size.saturating_sub(settings.fixed.len()))
        .into_iter()
        .filter_map(|comb| {
            let mut cfg = settings.fixed.clone();
            for c in comb {
                cfg.push(
                    templates
                        .iter()
                        .find(|t| t.profession == CLASSES[c] && t.tier == settings.tier_template)?
                        .config
                        .clone(),
                );
            }
            let mut count = [0; 9];
            for p in &cfg {
                if let Some(i) = CLASSES.iter().position(|x| p["name"].as_str() == Some(*x)) {
                    count[i] += 1;
                }
            }
            if (0..9).any(|i| count[i] < settings.minimum[i] || count[i] > settings.maximum[i]) {
                return None;
            }
            let mut s = settings.clone();
            s.hours = 2.;
            Some(Task {
                key: digest(&cfg),
                configs: cfg,
                settings: s,
            })
        })
        .collect()
}
fn compact(mut r: Run) -> Run {
    r.result["attacks"] = json!({});
    r
}
fn save(cp: &Checkpoint, home: &PathBuf) {
    if let Ok(db) = Store::open(&home.join("simulator.sqlite")) {
        let _ = db.put("checkpoint", &cp.id, cp);
    }
}
fn publish(cp: &Checkpoint, p: &Arc<Mutex<Progress>>) {
    let mut v = p.lock().unwrap();
    v.status = cp.status.clone();
    v.stage = cp.stage.clone();
    v.done = cp.done;
    v.total = cp.total;
    v.elapsed = cp.elapsed;
    v.leaders = cp.leaders.iter().take(20).cloned().collect();
    v.error = cp.errors.last().cloned().unwrap_or_default();
    if cp.comparison && (v.rows_round != cp.round || cp.round == 0) {
        let rows = if !cp.composition_best.is_empty() {
            &cp.composition_best
        } else {
            &cp.leaders
        };
        v.all_rows = Arc::new(thin_rows(rows));
        v.rows_round = cp.round;
    }
    v.checkpoint = if cp.status == "运行中" {
        None
    } else {
        Some(Arc::new(cp.clone()))
    };
}
fn batch(
    cp: &mut Checkpoint,
    res: &PathBuf,
    data: &PathBuf,
    home: &PathBuf,
    control: &Arc<AtomicU8>,
    p: &Arc<Mutex<Progress>>,
) {
    save(cp, home);
    let mut last_save = Instant::now();
    let pending = Arc::new(cp.pending.clone());
    let next = AtomicUsize::new(0);
    let output = Mutex::new(Vec::new());
    let start = Instant::now();
    let base_elapsed = cp.elapsed;
    let workers = cp.settings.workers.max(1).min(pending.len().max(1));
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let pending = &pending;
            let next = &next;
            let output = &output;
            let versions = cp.versions.clone();
            scope.spawn(move || {
                let mut runtime = match Runtime::new(res, data, versions) {
                    Ok(r) => r,
                    Err(e) => {
                        output
                            .lock()
                            .unwrap()
                            .push((usize::MAX, Err(e.to_string())));
                        return;
                    }
                };
                loop {
                    if control.load(Ordering::Relaxed) != 0 {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= pending.len() {
                        break;
                    }
                    let t = &pending[i];
                    let r = runtime
                        .run(t.configs.clone(), &t.settings, control, false)
                        .map(compact)
                        .map_err(|e| e.to_string());
                    output.lock().unwrap().push((i, r));
                }
            });
        }
        let mut finished = std::collections::HashSet::new();
        while finished.len() < pending.len() {
            for (i, r) in output.lock().unwrap().drain(..) {
                if i == usize::MAX {
                    cp.errors.push(r.err().unwrap());
                    control.store(2, Ordering::Relaxed);
                    continue;
                }
                match r {
                    Ok(r) => {
                        cp.runs.push(r);
                        finished.insert(i);
                        cp.done += 1;
                    }
                    Err(e) => {
                        if e != "interrupted" {
                            cp.errors.push(e);
                            finished.insert(i);
                            cp.done += 1;
                        }
                    }
                }
            }
            cp.elapsed = base_elapsed + start.elapsed().as_secs_f64();
            refresh_leaders(cp);
            if last_save.elapsed().as_secs() >= 5
                || control.load(Ordering::Relaxed) != 0
                || finished.len() == pending.len()
            {
                cp.pending = pending
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| !finished.contains(i))
                    .map(|(_, t)| t.clone())
                    .collect();
            }
            if last_save.elapsed().as_secs() >= 5 {
                save(cp, home);
                last_save = Instant::now();
            }
            if cp.errors.len() > 100 {
                cp.errors.drain(..cp.errors.len() - 100);
            }
            publish(cp, p);
            if control.load(Ordering::Relaxed) != 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
    // Workers have joined; collect jobs that completed while stop was being requested.
    for (i, r) in output.lock().unwrap().drain(..) {
        if let Ok(r) = r {
            if i != usize::MAX {
                let key = &pending[i].key;
                cp.pending.retain(|t| &t.key != key);
                cp.runs.push(r);
                cp.done += 1;
            }
        }
    }
    refresh_leaders(cp);
    save(cp, home);
    publish(cp, p);
}
pub fn start(
    mut cp: Checkpoint,
    res: PathBuf,
    data: PathBuf,
    home: PathBuf,
    control: Arc<AtomicU8>,
    p: Arc<Mutex<Progress>>,
    catalog: Value,
) {
    if cp.versions["engine"].as_str().is_some_and(|v| v != ENGINE_VERSION) {
        let mut progress = p.lock().unwrap();
        progress.job = cp.id.clone();
        progress.status = "失败：任务引擎版本已变化，请重新添加任务".into();
        progress.error = "旧引擎断点不能与新版战斗结果混用".into();
        return;
    }
    if cp.finite.as_ref().is_some_and(|s| s.version != crate::finite::RULES_VERSION) {
        let mut progress = p.lock().unwrap();
        progress.job = cp.id.clone();
        progress.status = "失败：搜索规则已变化，请重新添加任务".into();
        progress.error = "旧版筛选断点不能与新版搜索混用".into();
        return;
    }
    if cp.finite.is_some() {
        crate::finite::start(cp, res, data, home, control, p, catalog);
        return;
    }
    std::thread::spawn(move || {
        cp.status = "运行中".into();
        loop {
            batch(&mut cp, &res, &data, &home, &control, &p);
            if control.load(Ordering::Relaxed) != 0 {
                cp.status = if control.load(Ordering::Relaxed) == 1 {
                    "已暂停"
                } else {
                    "已取消"
                }
                .into();
                save(&cp, &home);
                publish(&cp, &p);
                return;
            }
            if cp.comparison {
                if comparison_advance(&mut cp, &catalog, &home) {
                    save(&cp, &home);
                    publish(&cp, &p);
                    return;
                }
                save(&cp, &home);
                publish(&cp, &p);
                continue;
            }
            if cp.leaders.is_empty() {
                cp.status = "失败：没有有效候选".into();
                save(&cp, &home);
                publish(&cp, &p);
                return;
            }
            if cp.stage == "最终长测" {
                let mut grouped: std::collections::BTreeMap<String, Vec<Run>> =
                    std::collections::BTreeMap::new();
                for r in &cp.runs {
                    grouped
                        .entry(digest(&r.configs))
                        .or_default()
                        .push(r.clone());
                }
                let mut leaders = vec![];
                for (_, rs) in grouped {
                    let mut r = rs[0].clone();
                    r.seed_runs = rs.clone();
                    r.seeds = rs.iter().map(|x| x.metrics.eph).collect();
                    let (mean, ci) = mean_ci(&r.seeds);
                    r.metrics.eph = mean;
                    r.metrics.failure =
                        rs.iter().map(|x| x.metrics.failure).sum::<f64>() / rs.len() as f64;
                    r.metrics.deaths =
                        rs.iter().map(|x| x.metrics.deaths).sum::<f64>() / rs.len() as f64;
                    r.ci95 = ci;
                    leaders.push(r);
                }
                leaders.sort_by(rank);
                cp.leaders = leaders;
                cp.status = "已完成：当前搜索范围内最佳".into();
                if cp.leaders.iter().all(|r| r.metrics.eph == 0.) {
                    cp.status = "已完成：未找到可通关阵容".into();
                }
                save(&cp, &home);
                if let Ok(db) = Store::open(&home.join("simulator.sqlite")) {
                    for r in &cp.leaders {
                        let _ = db.put("run", &r.id, r);
                    }
                }
                publish(&cp, &p);
                return;
            }
            let mut next = vec![];
            if cp.stage == "站位复核" {
                for r in cp.leaders.iter().take(10) {
                    for seed in 0..8 {
                        let mut s = cp.settings.clone();
                        s.hours = 48.;
                        s.seed = cp.settings.seed.wrapping_add(1_000_003 + seed * 7919);
                        let key = digest(&json!([r.configs, s.seed]));
                        next.push(Task {
                            configs: r.configs.clone(),
                            settings: s,
                            key,
                        });
                    }
                }
                cp.stage = "最终长测".into();
            } else if cp.elapsed >= cp.settings.budget_hours * 3600. * 0.8 {
                for r in cp.leaders.iter().take(20) {
                    for offset in 0..r.configs.len() {
                        let mut cfg = r.configs.clone();
                        cfg[cp.settings.fixed.len()..].rotate_left(
                            offset % (r.configs.len() - cp.settings.fixed.len()).max(1),
                        );
                        let mut s = cp.settings.clone();
                        s.hours = 8.;
                        s.seed = cp.settings.seed + 888;
                        next.push(Task {
                            key: digest(&cfg),
                            configs: cfg,
                            settings: s,
                        });
                    }
                }
                cp.stage = "站位复核".into();
            } else {
                let mut rng = StdRng::seed_from_u64(cp.settings.seed + cp.round);
                for r in cp.leaders.iter().take(40) {
                    next.push(Task {
                        key: digest(&r.configs),
                        configs: r.configs.clone(),
                        settings: stage_settings(&cp),
                    });
                    for _ in 0..6 {
                        let mut cfg = r.configs.clone();
                        mutate(&mut cfg, cp.settings.fixed.len(), &catalog, &mut rng);
                        next.push(Task {
                            key: digest(&cfg),
                            configs: cfg,
                            settings: stage_settings(&cp),
                        });
                    }
                }
                // Retain distinct class routes, beyond top-scoring local basin.
                let mut seen = std::collections::HashSet::new();
                for r in &cp.runs {
                    let route: Vec<_> = r.configs.iter().map(|c| c["name"].clone()).collect();
                    if seen.insert(digest(&route)) && next.len() < 340 {
                        next.push(Task {
                            key: digest(&r.configs),
                            configs: r.configs.clone(),
                            settings: stage_settings(&cp),
                        });
                    }
                }
                cp.stage = "联合局部搜索".into();
            }
            cp.pending = next;
            cp.total = cp.pending.len();
            cp.done = 0;
            cp.runs.clear();
            cp.round += 1;
            save(&cp, &home);
            publish(&cp, &p);
        }
    });
}
fn stage_settings(cp: &Checkpoint) -> Settings {
    let mut s = cp.settings.clone();
    s.hours = if cp.round < 3 { 4. } else { 8. };
    s.seed = cp.settings.seed + cp.round * 104729;
    s
}
pub fn checkpoint(
    settings: Settings,
    templates: &[Template],
    size: usize,
    versions: Value,
) -> Checkpoint {
    let pending = tasks(&settings, templates, size);
    Checkpoint {
        id: format!("search-{}", chrono::Utc::now().timestamp_millis()),
        versions,
        settings,
        stage: "职业组合覆盖".into(),
        elapsed: 0.,
        round: 0,
        total: pending.len(),
        pending,
        runs: vec![],
        leaders: vec![],
        errors: vec![],
        status: "等待开始".into(),
        comparison: false,
        finite: None,
        composition_best: vec![],
        done: 0,
    }
}
fn eligible(catalog: &Value, cls: &str, special: bool) -> Vec<String> {
    catalog["searchPools"]["professions"][cls]["abilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["eligible"] == true && a["special"] == special)
        .filter_map(|a| a["hrid"].as_str().map(str::to_owned))
        .collect()
}
fn ensure_triggers(c: &mut Value, catalog: &Value) {
    let mut selected: Vec<String> = c["abilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["abilityHrid"].as_str())
        .filter(|h| !h.is_empty())
        .map(str::to_owned)
        .collect();
    for key in ["food", "drinks"] {
        selected.extend(
            c[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|h| h.as_str())
                .filter(|h| !h.is_empty())
                .map(str::to_owned),
        );
    }
    for h in selected {
        if c["triggerMap"].get(&h).is_none() {
            let t = if h.starts_with("/abilities/") {
                &catalog["abilities"][&h]["defaultCombatTriggers"]
            } else {
                &catalog["items"][&h]["consumableDetail"]["defaultCombatTriggers"]
            };
            c["triggerMap"][&h] = if t.is_array() { t.clone() } else { json!([]) };
        }
    }
}
pub fn normalize_search_config(c: &mut Value, catalog: &Value) {
    remove_task_badges(c);
    let cls = c["name"].as_str().unwrap_or("water").to_owned();
    let pools = [
        eligible(catalog, &cls, true),
        eligible(catalog, &cls, false),
    ];
    let mut used = std::collections::HashSet::new();
    for i in 0..5 {
        let pool = &pools[if i == 0 { 0 } else { 1 }];
        let current = c["abilities"][i]["abilityHrid"].as_str().unwrap_or("");
        let h = if pool.iter().any(|h| h == current) && !used.contains(current) {
            current.to_owned()
        } else {
            pool.iter()
                .find(|h| !used.contains(h.as_str()))
                .cloned()
                .unwrap_or_default()
        };
        used.insert(h.clone());
        c["abilities"][i]["abilityHrid"] = json!(h);
    }
    if catalog["searchPools"]["professions"][&cls]["food"].is_array() {
        c["food"] = catalog["searchPools"]["professions"][&cls]["food"].clone();
    }
    if let Some(ds) = c["drinks"].as_array_mut() {
        for h in ds {
            if *h == "/items/wisdom_coffee" {
                *h = json!("/items/critical_coffee");
            }
        }
    }
    ensure_triggers(c, catalog);
}
fn mutate(cfg: &mut Vec<Value>, fixed: usize, catalog: &Value, rng: &mut StdRng) {
    if fixed >= cfg.len() {
        return;
    }
    let index = rng.random_range(fixed..cfg.len());
    let c = &mut cfg[index];
    let cls = c["name"].as_str().unwrap_or("water").to_owned();
    match rng.random_range(0..5) {
        0 | 1 => {
            let special = rng.random_bool(0.35);
            let slot = if special { 0 } else { rng.random_range(1..5) };
            let pool = eligible(catalog, &cls, special);
            if !pool.is_empty() {
                let hrid = &pool[rng.random_range(0..pool.len())];
                if !c["abilities"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .enumerate()
                    .any(|(i, a)| i != slot && a["abilityHrid"] == *hrid)
                {
                    c["abilities"][slot]["abilityHrid"] = json!(hrid);
                }
            }
        }
        2 => {
            let a = rng.random_range(1..5);
            let b = rng.random_range(1..5);
            c["abilities"].as_array_mut().unwrap().swap(a, b);
        }
        3 => {
            if let Some(m) = c["triggerMap"].as_object_mut() {
                for conditions in m.values_mut() {
                    if let Some(arr) = conditions.as_array_mut() {
                        for t in arr {
                            if let Some(v) = t["value"].as_f64() {
                                if v > 1. {
                                    t["value"] = json!((v * rng.random_range(0.7..1.3)).round());
                                }
                            }
                        }
                    }
                }
            }
        }
        _ => {
            let choices: Vec<_> = catalog["searchPools"]["coffeePool"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|h| h.as_str())
                .collect();
            if !choices.is_empty() {
                let slot = rng.random_range(0..3);
                let value = choices[rng.random_range(0..choices.len())];
                let chosen = &catalog["items"][value]["consumableDetail"]["buffs"];
                let conflict=c["drinks"].as_array().unwrap().iter().enumerate().filter(|(i,_)|*i!=slot).any(|(_,other)| other==value || catalog["items"][other.as_str().unwrap_or("")]["consumableDetail"]["buffs"].as_array().into_iter().flatten().any(|b|chosen.as_array().into_iter().flatten().any(|a|a["uniqueHrid"]==b["uniqueHrid"])));
                if !conflict {
                    c["drinks"][slot] = json!(value);
                }
            }
        }
    }
    ensure_triggers(c, catalog);
}
fn composition_key(configs: &[Value]) -> String {
    let mut classes: Vec<_> = configs
        .iter()
        .map(|c| c["name"].as_str().unwrap_or(""))
        .collect();
    classes.sort();
    classes.join("|")
}
pub fn comparison_checkpoint(
    mut settings: Settings,
    templates: &[Template],
    size: usize,
    versions: Value,
    catalog: &Value,
) -> Checkpoint {
    settings.fixed.clear();
    let mut cp = checkpoint(settings, templates, size, versions);
    cp.comparison = true;
    cp.stage = "全阵容初测".into();
    for task in &mut cp.pending {
        for c in &mut task.configs {
            normalize_search_config(c, catalog);
        }
        task.key = digest(&task.configs);
    }
    crate::finite::setup(&mut cp, catalog);
    cp
}
pub(crate) fn average_runs(rs: &[Run]) -> Run {
    let mut r = rs[0].clone();
    r.seed_runs = rs.to_vec();
    r.seeds = rs.iter().map(|x| x.metrics.eph).collect();
    let (mean, ci) = mean_ci(&r.seeds);
    r.metrics.eph = mean;
    r.ci95 = ci;
    let n = rs.len() as f64;
    r.metrics.dps = rs.iter().map(|x| x.metrics.dps).sum::<f64>() / n;
    macro_rules! avg {($($field:ident),*)=>{$(r.metrics.$field=rs.iter().map(|x|x.metrics.$field).sum::<f64>()/n;)*};}
    avg!(
        failure,
        deaths,
        hours,
        completed,
        failed,
        mana,
        consumables,
        xp,
        ranked_hours,
        unfinished_hours,
        failed_hours
    );
    for i in 0..r.configs.len() {
        r.metrics.player_dps[i] = rs.iter().map(|x| x.metrics.player_dps[i]).sum::<f64>() / n;
    }
    let hours = rs.iter().map(|r| r.metrics.hours).sum::<f64>().max(1e-9);
    r.metrics.member_deaths_per_hour = (0..r.configs.len())
        .map(|i| {
            rs.iter()
                .map(|r| {
                    r.metrics
                        .member_deaths_per_hour
                        .get(i)
                        .copied()
                        .unwrap_or(0.)
                        * r.metrics.hours
                })
                .sum::<f64>()
                / hours
        })
        .collect();
    r.metrics.member_mana_shortage = (0..r.configs.len())
        .map(|i| {
            rs.iter()
                .any(|r| r.metrics.member_mana_shortage.get(i) == Some(&true))
        })
        .collect();
    r
}
fn comparison_advance(cp: &mut Checkpoint, catalog: &Value, home: &PathBuf) -> bool {
    if cp.runs.is_empty() {
        cp.status = "没有可比较的结果，请检查筛选条件".into();
        return true;
    }
    let mut grouped: std::collections::BTreeMap<String, Vec<Run>> =
        std::collections::BTreeMap::new();
    for r in &cp.runs {
        grouped
            .entry(composition_key(&r.configs))
            .or_default()
            .push(r.clone());
    }
    let final_stage = cp.stage == "全阵容复核";
    cp.composition_best = grouped
        .into_values()
        .map(|mut rs| {
            if final_stage {
                average_runs(&rs)
            } else {
                rs.sort_by(rank);
                rs.remove(0)
            }
        })
        .collect();
    cp.composition_best.sort_by(rank);
    // Keep every composition, including routes with no successful clear.
    if final_stage {
        cp.leaders = cp.composition_best.clone();
        cp.status = "比较完成".into();
        if let Ok(db) = Store::open(&home.join("simulator.sqlite")) {
            for r in &cp.composition_best {
                let _ = db.put("run", &r.id, r);
            }
            let _ = db.put("comparison", &cp.id, &thin_rows(&cp.composition_best));
        }
        cp.composition_best = thin_rows(&cp.composition_best);
        cp.leaders = cp.composition_best.clone();
        cp.runs.clear();
        return true;
    }
    let mut next = vec![];
    let review = cp.elapsed >= cp.settings.budget_hours * 3600. * 0.8;
    for base in &cp.composition_best {
        if review {
            for i in 0..cp.settings.comparison_seeds.max(1) {
                let mut s = cp.settings.clone();
                s.hours = cp.settings.hours;
                s.seed = cp.settings.seed.wrapping_add(1_000_003 + i as u64 * 7919);
                next.push(Task {
                    key: digest(&json!([base.configs, s.seed])),
                    configs: base.configs.clone(),
                    settings: s,
                });
            }
        } else {
            let mut s = cp.settings.clone();
            s.hours = 4.;
            s.seed = cp.settings.seed + 104729 * (cp.round + 1);
            let mut rng = StdRng::seed_from_u64(
                cp.settings.seed
                    + cp.round
                    + base
                        .configs
                        .iter()
                        .map(|c| {
                            c["name"]
                                .as_str()
                                .unwrap_or("")
                                .bytes()
                                .map(|x| x as u64)
                                .sum::<u64>()
                        })
                        .sum::<u64>(),
            );
            for k in 0..5 {
                let mut cfg = base.configs.clone();
                if k > 0 {
                    mutate(&mut cfg, 0, catalog, &mut rng);
                }
                next.push(Task {
                    key: digest(&cfg),
                    configs: cfg,
                    settings: s.clone(),
                });
            }
        }
    }
    cp.pending = next;
    cp.total = cp.pending.len();
    cp.done = 0;
    cp.round += 1;
    cp.runs.clear();
    cp.leaders = cp.composition_best.clone();
    cp.stage = if review {
        "全阵容复核"
    } else {
        "逐阵容优化"
    }
    .into();
    false
}

fn thin_row(r: &Run) -> Run {
    Run {
        id: r.id.clone(),
        configs: r.configs.clone(),
        settings: r.settings.clone(),
        metrics: r.metrics.clone(),
        result: Value::Null,
        versions: r.versions.clone(),
        seeds: r.seeds.clone(),
        ci95: r.ci95,
        seed_runs: vec![],
    }
}
pub fn thin_rows(rows: &[Run]) -> Vec<Run> {
    rows.iter().map(thin_row).collect()
}
fn refresh_leaders(cp: &mut Checkpoint) {
    if cp.comparison && !cp.composition_best.is_empty() {
        cp.leaders = cp.composition_best.iter().take(20).map(thin_row).collect();
        return;
    }
    let mut refs: Vec<&Run> = cp.runs.iter().collect();
    refs.sort_by(|a, b| rank(a, b));
    let mut unique = std::collections::HashSet::new();
    if cp.comparison {
        cp.leaders = refs
            .into_iter()
            .filter(|r| unique.insert(composition_key(&r.configs)))
            .map(thin_row)
            .collect();
    } else {
        cp.leaders = refs
            .into_iter()
            .filter(|r| unique.insert(digest(&r.configs)))
            .take(100)
            .cloned()
            .collect();
    }
}
pub fn profession_count(r: &Run, cls: &str) -> usize {
    r.configs.iter().filter(|c| c["name"] == cls).count()
}
pub fn profession_average_dps(r: &Run, cls: &str) -> Option<f64> {
    let count = profession_count(r, cls);
    (count > 0).then(|| profession_dps(r, cls) / count as f64)
}
pub fn profession_dps(r: &Run, cls: &str) -> f64 {
    let ds: Vec<f64> = r
        .configs
        .iter()
        .enumerate()
        .filter(|(_, c)| c["name"] == cls)
        .filter_map(|(i, _)| r.metrics.player_dps.get(i).copied())
        .collect();
    if ds.is_empty() {
        0.
    } else {
        ds.iter().sum::<f64>()
    }
}

#[cfg(test)]
mod comparison_coverage_tests {
    use super::*;
    #[test]
    fn optimization_does_not_eliminate_profession_compositions() {
        let resources = crate::runtime::resource_dir();
        let templates: Vec<Template> =
            serde_json::from_slice(&std::fs::read(resources.join("templates.json")).unwrap())
                .unwrap();
        let mut adapter =
            crate::runtime::Adapter::new(&resources, &resources.join("game-data.json")).unwrap();
        let catalog = adapter.request(json!({"op":"catalog"})).unwrap();
        let mut cp = comparison_checkpoint(Settings::default(), &templates, 3, json!({}), &catalog);
        cp.runs = cp
            .pending
            .iter()
            .enumerate()
            .map(|(i, t)| Run {
                id: format!("test-{i}"),
                configs: t.configs.clone(),
                settings: t.settings.clone(),
                metrics: Metrics {
                    eph: i as f64,
                    player_dps: vec![10.; 3],
                    ..Metrics::default()
                },
                result: Value::Null,
                versions: json!({}),
                seeds: vec![],
                ci95: 0.,
                seed_runs: vec![],
            })
            .collect();
        let home = std::env::temp_dir().join("comparison-coverage");
        assert!(!comparison_advance(&mut cp, &catalog, &home));
        assert_eq!(cp.composition_best.len(), 165);
        assert_eq!(cp.pending.len(), 165 * 5);
        let keys: std::collections::HashSet<_> = cp
            .pending
            .iter()
            .map(|t| composition_key(&t.configs))
            .collect();
        assert_eq!(keys.len(), 165);
        for t in cp.pending {
            for c in t.configs {
                let cls = c["name"].as_str().unwrap();
                for a in c["abilities"].as_array().unwrap() {
                    let h = a["abilityHrid"].as_str().unwrap();
                    if h.is_empty() {
                        continue;
                    }
                    assert!(
                        catalog["searchPools"]["professions"][cls]["abilities"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|a| a["hrid"] == h && a["eligible"] == true)
                    );
                }
                assert!(
                    !c["drinks"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("/items/wisdom_coffee"))
                );
            }
        }
    }
}
