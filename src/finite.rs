//! Finite, exhaustive loadout enumeration and successive halving. No random mutation loop.
use crate::{
    model::*,
    runtime::Runtime,
    search::{Checkpoint, Progress, thin_rows},
    store::Store,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Plan {
    pub base: Vec<Value>,
    pub regular: Vec<(String, Vec<Vec<String>>)>,
    pub auras: Vec<Vec<String>>,
    pub count: usize,
}
pub const RULES_VERSION: u32 = 4;
pub const GENERIC: [&str; 6] = [
    "speed_aura",
    "guardian_aura",
    "mystic_aura",
    "fierce_aura",
    "critical_aura",
    "insanity",
];
fn choose(pool: &[String], n: usize) -> Vec<Vec<String>> {
    fn go(p: &[String], n: usize, start: usize, v: &mut Vec<String>, o: &mut Vec<Vec<String>>) {
        if v.len() == n {
            o.push(v.clone());
            return;
        }
        for i in start..p.len() {
            v.push(p[i].clone());
            go(p, n, i + 1, v, o);
            v.pop();
        }
    }
    let mut o = vec![];
    go(pool, n, 0, &mut vec![], &mut o);
    o
}
pub fn regular_options(cls: &str, cat: &Value) -> Vec<Vec<String>> {
    let p = &cat["searchPools"]["professions"][cls];
    let entries: Vec<_> = p["abilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["eligible"] == true && a["special"] == false)
        .collect();
    let required: Vec<String> = entries
        .iter()
        .filter(|a| a["usage"].as_f64().unwrap_or(0.) > 0.99)
        .filter_map(|a| a["hrid"].as_str().map(str::to_owned))
        .collect();
    let optional: Vec<String> = entries
        .iter()
        .filter_map(|a| a["hrid"].as_str())
        .filter(|h| !required.iter().any(|r| r == h))
        .map(str::to_owned)
        .collect();
    let n = 4usize.saturating_sub(required.len()).min(optional.len());
    choose(&optional, n)
        .into_iter()
        .map(|mut set| {
            set.extend(required.clone());
            let mut votes = BTreeMap::<Vec<String>, u64>::new();
            for row in p["ordinaryOrders"].as_array().into_iter().flatten() {
                let order: Vec<String> = row["skills"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(|h| set.iter().any(|s| s == h))
                    .map(str::to_owned)
                    .collect();
                if order.len() == set.len() {
                    *votes.entry(order).or_default() += row["count"].as_u64().unwrap_or(0);
                }
            }
            votes
                .into_iter()
                .max_by(|(a, n), (b, m)| n.cmp(m).then_with(|| b.cmp(a)))
                .map(|(v, _)| v)
                .unwrap_or_else(|| {
                    set.sort_by_key(|h| {
                        entries.iter().position(|a| a["hrid"] == *h).unwrap_or(999)
                    });
                    set
                })
        })
        .collect()
}
pub fn aura_options(cls: &str, classes: &[String], cat: &Value) -> Vec<String> {
    let magic = classes
        .iter()
        .any(|c| ["water", "fire", "nature"].contains(&c.as_str()));
    let physical = classes
        .iter()
        .any(|c| !["water", "fire", "nature"].contains(&c.as_str()));
    let mut v: Vec<String> = cat["searchPools"]["professions"][cls]["abilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["special"] == true && a["eligible"] == true)
        .filter_map(|a| a["hrid"].as_str().map(str::to_owned))
        .collect();
    for h in GENERIC {
        let h = format!("/abilities/{h}");
        if cat["abilities"][&h]["isSpecialAbility"] == true && !v.contains(&h) {
            v.push(h)
        }
    }
    v.retain(|h| {
        (h != "/abilities/mystic_aura" || magic) && (h != "/abilities/fierce_aura" || physical)
    });
    if cls != "water" {
        v.retain(|h| h != "/abilities/insanity");
    }
    v.sort();
    if v.is_empty() {
        v.push(String::new())
    }
    v
}
pub fn fixed_config(c: &mut Value, cat: &Value) {
    remove_task_badges(c);
    let cls = c["name"].as_str().unwrap_or("water").to_string();
    let p = &cat["searchPools"]["professions"][&cls];
    for (dst, src) in [
        ("food", "food"),
        ("drinks", "fixedDrinks"),
        ("triggerMap", "fixedTriggers"),
    ] {
        if !p[src].is_null() {
            c[dst] = p[src].clone();
        }
    }
    let coffee = crate::coffee::options(c, cat);
    crate::coffee::apply(c, &coffee[0], cat);
    let classes = vec![cls.clone()];
    let legal = aura_options(&cls, &classes, cat);
    if let Some(a) = p["abilities"].as_array().into_iter().flatten().find(|a| {
        a["special"] == true && a["eligible"] == true && legal.iter().any(|h| a["hrid"] == *h)
    }) {
        c["abilities"][0]["abilityHrid"] = a["hrid"].clone();
    }
    let opts = regular_options(&cls, cat);
    if let Some(set) = opts.first() {
        set_regular(c, set);
    }
    defaults(c, cat);
}
fn defaults(c: &mut Value, cat: &Value) {
    for h in c["abilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["abilityHrid"].as_str())
        .map(str::to_owned)
        .collect::<Vec<_>>()
    {
        if c["triggerMap"].get(&h).is_none() {
            let t = &cat["abilities"][&h]["defaultCombatTriggers"];
            c["triggerMap"][&h] = if t.is_array() { t.clone() } else { json!([]) };
        }
    }
}
fn set_regular(c: &mut Value, skills: &[String]) {
    for i in 0..4 {
        c["abilities"][i + 1]["abilityHrid"] = json!(skills.get(i).cloned().unwrap_or_default());
    }
}
pub fn team_aura(h: &str, cat: &Value) -> bool {
    cat["abilities"][h]["abilityEffects"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|e| e["targetType"] == "allAllies")
}
fn aura_skill(h: &str, cat: &Value) -> String {
    cat["abilities"][h]["abilityEffects"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|e| e["buffs"].as_array().into_iter().flatten())
        .filter_map(|b| b["multiplierForSkillHrid"].as_str())
        .find(|s| !s.is_empty())
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}
fn carrier_rank(c: &Value, h: &str, cat: &Value) -> (bool, f64) {
    let skill = aura_skill(h, cat);
    let weapon = c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or("");
    let primary = cat["items"][weapon]["equipmentDetail"]["combatStats"]["primaryTraining"]
        .as_str()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("");
    (primary == skill, c["levels"][&skill].as_f64().unwrap_or(0.))
}
fn better(a: (bool, f64), b: (bool, f64)) -> bool {
    a.0 > b.0 || (a.0 == b.0 && a.1 > b.1 + 1e-9)
}
/// Enumerate team buffs once, self buffs independently; canonicalize exchangeable members.
pub fn aura_assignments(base: &[Value], cat: &Value) -> Vec<Vec<String>> {
    let classes: Vec<String> = base
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_string())
        .collect();
    let mut options: Vec<Vec<String>> = classes
        .iter()
        .map(|c| aura_options(c, &classes, cat))
        .collect();
    for i in 0..options.len() {
        options[i].retain(|h| {
            !team_aura(h, cat)
                || !base.iter().enumerate().any(|(j, c)| {
                    j != i
                        && aura_options(&classes[j], &classes, cat).contains(h)
                        && better(carrier_rank(c, h, cat), carrier_rank(&base[i], h, cat))
                })
        });

        options[i].sort();
        options[i].dedup();
    }
    // Identity includes every fixed setting except the selected special, not just class name.
    let identities: Vec<String> = base
        .iter()
        .map(|c| {
            let mut v = c.clone();
            v["abilities"][0]["abilityHrid"] = json!("");
            digest(&v)
        })
        .collect();
    fn visit(
        i: usize,
        options: &[Vec<String>],
        ids: &[String],
        cat: &Value,
        chosen: &mut Vec<String>,
        used: &mut HashSet<String>,
        out: &mut Vec<Vec<String>>,
    ) {
        if i == options.len() {
            out.push(chosen.clone());
            return;
        }
        for h in &options[i] {
            let team = team_aura(h, cat);
            if team && used.contains(h) {
                continue;
            }
            if let Some(j) = (0..i).rev().find(|j| ids[*j] == ids[i]) {
                if h < &chosen[j] {
                    continue;
                }
            }
            if team {
                used.insert(h.clone());
            }
            chosen.push(h.clone());
            visit(i + 1, options, ids, cat, chosen, used, out);
            chosen.pop();
            if team {
                used.remove(h);
            }
        }
    }
    let mut out = vec![];
    visit(
        0,
        &options,
        &identities,
        cat,
        &mut vec![],
        &mut HashSet::new(),
        &mut out,
    );
    out
}
pub fn plan(mut base: Vec<Value>, cat: &Value) -> Plan {
    for c in &mut base {
        fixed_config(c, cat)
    }
    let mut classes: Vec<String> = base
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_string())
        .collect();
    classes.sort();
    classes.dedup();
    let regular: Vec<_> = classes
        .into_iter()
        .map(|c| {
            let o = regular_options(&c, cat);
            (c, o)
        })
        .collect();
    let auras = aura_assignments(&base, cat);
    let count = regular.iter().map(|(_, o)| o.len()).product::<usize>() * auras.len();
    // Use a legal, most-covered aura allocation for the quick profession preview as well.
    if let Some(assignment) = auras
        .iter()
        .max_by_key(|a| a.iter().filter(|h| !h.is_empty()).count())
    {
        for (i, h) in assignment.iter().enumerate() {
            base[i]["abilities"][0]["abilityHrid"] = json!(h);
            defaults(&mut base[i], cat);
        }
    }
    Plan {
        base,
        regular,
        auras,
        count,
    }
}
impl Plan {
    pub fn configs(&self, mut index: usize, cat: &Value) -> Vec<Value> {
        assert!(index < self.count);
        let mut c = self.base.clone();
        for (cls, opts) in &self.regular {
            let skills = &opts[index % opts.len()];
            index /= opts.len();
            for p in &mut c {
                if p["name"] == *cls {
                    set_regular(p, skills)
                }
            }
        }
        for (i, h) in self.auras[index].iter().enumerate() {
            c[i]["abilities"][0]["abilityHrid"] = json!(h);
            defaults(&mut c[i], cat);
        }
        c
    }
}
#[derive(Clone, Copy, Serialize, Deserialize, Default)]
pub struct Ref {
    pub candidate: usize,
    pub plan: usize,
    pub ordinal: usize,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct State {
    pub version: u32,
    pub stage: u8,
    pub cursor: usize,
    pub initial: usize,
    pub plans: Arc<Vec<Plan>>,
    pub selected: Vec<Ref>,
    #[serde(default)]
    pub selection_count: usize,
    pub durations: [f64; 3],
}
pub fn setup(cp: &mut Checkpoint, cat: &Value) {
    let plans: Vec<_> = cp
        .pending
        .iter()
        .map(|t| plan(t.configs.clone(), cat))
        .filter(|p| p.count > 0)
        .collect();
    let initial = plans.iter().map(|p| p.count).sum();
    for t in &mut cp.pending {
        for c in &mut t.configs {
            fixed_config(c, cat)
        }
        t.settings.hours = 1.;
    }
    cp.finite = Some(State {
        version: RULES_VERSION,
        stage: 0,
        cursor: 0,
        initial,
        plans: Arc::new(plans),
        selected: vec![],
        selection_count: 0,
        durations: [1., 24., 48.],
    });
}
fn reference(s: &State, index: usize) -> Ref {
    if s.stage > 1 {
        return s.selected[index];
    }
    let mut offset = 0;
    for (i, p) in s.plans.iter().enumerate() {
        if index < offset + p.count {
            return Ref {
                candidate: index,
                plan: i,
                ordinal: index - offset,
            };
        }
        offset += p.count;
    }
    unreachable!()
}
fn snapshot(cp: &Checkpoint, p: &Arc<Mutex<Progress>>) {
    let mut v = p.lock().unwrap();
    v.status = cp.status.clone();
    v.stage = cp.stage.clone();
    v.done = cp.done;
    v.total = cp.total;
    v.elapsed = cp.elapsed;
    v.error = cp.errors.last().cloned().unwrap_or_default();
    v.all_rows = Arc::new(thin_rows(&cp.leaders));
    v.leaders = thin_rows(&cp.leaders.iter().take(10).cloned().collect::<Vec<_>>());
    v.rows_round = cp.round;
    v.job = cp.id.clone();
    if let Some(state) = &cp.finite {
        v.initial_candidates = state.initial;
        v.profession_routes = state.plans.len();
    }
    v.checkpoint = if cp.status == "运行中" {
        None
    } else {
        Some(Arc::new(cp.clone()))
    };
}
fn persist(cp: &Checkpoint, home: &PathBuf) -> anyhow::Result<()> {
    Store::open(&home.join("simulator.sqlite"))?.put("checkpoint", &cp.id, cp)
}
fn top_rows(
    db: &Store,
    job: &str,
    stage: u8,
    plans: &[Plan],
    settings: &Settings,
    versions: &Value,
    cat: &Value,
) -> anyhow::Result<Vec<Run>> {
    let mut refs = db.finite_top(job, stage, 200, None, false, 0)?;
    let mut seen: HashSet<usize> = refs.iter().map(|x| x.0.candidate).collect();
    for i in 0..9 {
        let mut profession_rows = db.finite_top(job, stage, 10, Some(i), false, 0)?;
        profession_rows.extend(db.finite_top(job, stage, 10, Some(i), true, 0)?);
        for x in profession_rows {
            if seen.insert(x.0.candidate) {
                refs.push(x)
            }
        }
    }
    let mut rows = vec![];
    for (r, m, id) in refs {
        if stage == 3 {
            if let Some(full) = db.get::<Run>("run", &id)? {
                rows.extend(thin_rows(&[full]));
                continue;
            }
        }
        let mut configs = if stage == 0 {
            plans[r.plan].base.clone()
        } else {
            plans[r.plan].configs(r.ordinal, cat)
        };
        if let Some(payload) = db.finite_coffee(job, stage, r.candidate)? {
            restore_screen_config(&mut configs, &payload, cat);
        }
        rows.push(Run {
            id,
            configs,
            settings: settings.clone(),
            metrics: m,
            result: Value::Null,
            versions: versions.clone(),
            seeds: vec![],
            ci95: 0.,
            seed_runs: vec![],
        });
    }
    rows.sort_by(rank);
    Ok(rows)
}

type WorkerResult = (usize, Ref, Result<Run, String>);
fn result_channel(workers: usize) -> (std::sync::mpsc::SyncSender<WorkerResult>, std::sync::mpsc::Receiver<WorkerResult>) {
    std::sync::mpsc::sync_channel(workers.max(1))
}
/// Screening stores metrics and selected loadouts/audits, not battle histories.
/// Compact before enqueueing, so a slow database cannot retain large raw results.
fn queued_run(mut run: Run, stage: u8) -> Run {
    if stage < 3 {
        let mut result = std::mem::take(&mut run.result);
        run.result = json!({
            "coffeeAdjustment": result.get_mut("coffeeAdjustment").map(Value::take).unwrap_or(Value::Null),
            "foodAdjustment": result.get_mut("foodAdjustment").map(Value::take).unwrap_or(Value::Null),
        });
        run.seed_runs.clear();
    }
    run
}

pub fn start(
    mut cp: Checkpoint,
    res: PathBuf,
    data: PathBuf,
    home: PathBuf,
    control: Arc<AtomicU8>,
    progress: Arc<Mutex<Progress>>,
    catalog: Value,
) {
    std::thread::spawn(move || {
        let outcome = (|| -> anyhow::Result<()> {
            let db = Store::open(&home.join("simulator.sqlite"))?;
            db.finite_init()?;
            db.put("finite-last-job", "last", &cp.id)?;
            db.put("finite-job-settings", &cp.id, &cp.settings)?;
            db.put("finite-job-versions", &cp.id, &cp.versions)?;
            db.put(
                "finite-plan-names",
                &cp.id,
                &cp.finite
                    .as_ref()
                    .unwrap()
                    .plans
                    .iter()
                    .map(|p| p.base.iter().map(|c| c["name"].clone()).collect::<Vec<_>>())
                    .collect::<Vec<_>>(),
            )?;
            let started = Instant::now();
            let base_elapsed = cp.elapsed;
            cp.status = "运行中".into();
            loop {
                let state = cp.finite.as_ref().unwrap().clone();
                let total = if state.stage == 0 {
                    state.plans.len()
                } else if state.stage == 1 {
                    state.initial
                } else {
                    state.selection_count
                };
                cp.total = total;
                cp.done = state.cursor;
                cp.stage = match state.stage {
                    0 => "职业阵容预览 · 1小时",
                    1 => "全量技能与光环 · 1小时",
                    2 => "各职业前50 · 24小时",
                    _ => "各职业前10 · 多种子48小时",
                }
                .into();
                persist(&cp, &home)?;
                snapshot(&cp, &progress);
                let next = AtomicUsize::new(state.cursor);
                let owned_settings = cp.settings.clone();
                let settings = &owned_settings;
                let owned_versions = cp.versions.clone();
                let versions = &owned_versions;
                let plans = &state.plans;
                let cat = &catalog;
                let control_ref = &control;
                let res_ref = &res;
                let data_ref = &data;
                let home_ref = &home;
                let job_owned = cp.id.clone();
                let job = &job_owned;
                std::thread::scope(|scope| -> anyhow::Result<()> {
                    let workers = cp.settings.workers.max(1).min(total.max(1));
                    // Keep at most one queued result per worker. Define the receiver
                    // inside the scope so an error drops it before scoped workers join.
                    let (sender, receiver) = result_channel(workers);
                    for _ in 0..workers {
                        let sender = sender.clone();
                        let next = &next;
                        let state = &state;
                        scope.spawn(move || {
                            let mut runtime =
                                match Runtime::new(res_ref, data_ref, versions.clone()) {
                                    Ok(r) => r,
                                    Err(e) => {
                                        let _ = sender.send((
                                            usize::MAX,
                                            Ref::default(),
                                            Err(e.to_string()),
                                        ));
                                        return;
                                    }
                                };
                            let local_db = Store::open(&home_ref.join("simulator.sqlite")).unwrap();
                            loop {
                                if control_ref.load(Ordering::Relaxed) != 0 {
                                    break;
                                }
                                let i = next.fetch_add(1, Ordering::Relaxed);
                                if i >= total {
                                    break;
                                }
                                let r = if state.stage == 0 {
                                    Ref {
                                        candidate: i,
                                        plan: i,
                                        ordinal: 0,
                                    }
                                } else {
                                    if state.stage > 1 {
                                        match local_db.finite_reference(job, state.stage, i) {
                                            Ok(r) => r,
                                            Err(e) => {
                                                let _ = sender.send((
                                                    usize::MAX,
                                                    Ref::default(),
                                                    Err(e.to_string()),
                                                ));
                                                break;
                                            }
                                        }
                                    } else {
                                        reference(state, i)
                                    }
                                };
                                let mut configs = if state.stage == 0 {
                                    plans[r.plan].base.clone()
                                } else {
                                    plans[r.plan].configs(r.ordinal, cat)
                                };
                                let previous_coffee = if state.stage >= 2 {
                                    match local_db.finite_coffee(job, state.stage - 1, r.candidate)
                                    {
                                        Ok(Some(v)) => v,
                                        Ok(None) => {
                                            let _ = sender.send((
                                                usize::MAX,
                                                Ref::default(),
                                                Err("初筛咖啡配置缺失，请重新开始比较".into()),
                                            ));
                                            break;
                                        }
                                        Err(e) => {
                                            let _ = sender.send((
                                                usize::MAX,
                                                Ref::default(),
                                                Err(e.to_string()),
                                            ));
                                            break;
                                        }
                                    }
                                } else {
                                    Value::Null
                                };
                                restore_screen_config(&mut configs, &previous_coffee, cat);
                                let mut s = settings.clone();
                                s.hours = state.durations[if state.stage <= 1 {
                                    0
                                } else {
                                    state.stage as usize - 1
                                }];
                                s.seed = settings.seed.wrapping_add(if state.stage <= 1 {
                                    0
                                } else {
                                    state.stage as u64 * 104729
                                });
                                let result = if state.stage == 0 {
                                    runtime
                                        .run(configs, &s, control_ref, false)
                                        .map_err(|e| e.to_string())
                                } else if state.stage == 1 {
                                    crate::food::screen(
                                        &mut runtime,
                                        configs,
                                        &s,
                                        control_ref,
                                        cat,
                                    )
                                    .map_err(|e| e.to_string())
                                } else if state.stage == 2 {
                                    runtime
                                        .run(configs, &s, control_ref, false)
                                        .map(|mut r| {
                                            r.result["coffeeAdjustment"] =
                                                previous_coffee["audit"].clone();
                                            r.result["foodAdjustment"] = previous_coffee["foodAudit"].clone();
                                            r
                                        })
                                        .map_err(|e| e.to_string())
                                } else {
                                    let mut runs = vec![];
                                    let mut error = None;
                                    for seed in 0..settings.comparison_seeds.max(1) {
                                        let sid = format!("{}-{}-{}", job, r.candidate, seed);
                                        if let Ok(Some(saved)) =
                                            local_db.get::<Run>("finite-seed", &sid)
                                        {
                                            runs.push(saved);
                                            continue;
                                        }
                                        s.seed = settings
                                            .seed
                                            .wrapping_add(1_000_003 + seed as u64 * 7919);
                                        match runtime.run(configs.clone(), &s, control_ref, false) {
                                            Ok(mut run) => {
                                                run.result["coffeeAdjustment"] =
                                                    previous_coffee["audit"].clone();
                                                run.result["foodAdjustment"] = previous_coffee["foodAudit"].clone();
                                                run.result["attacks"] = json!({});
                                                if let Err(e) =
                                                    local_db.put("finite-seed", &sid, &run)
                                                {
                                                    error = Some(e.to_string());
                                                    break;
                                                }
                                                runs.push(run)
                                            }
                                            Err(e) => {
                                                error = Some(e.to_string());
                                                break;
                                            }
                                        }
                                    }
                                    if let Some(e) = error {
                                        Err(e)
                                    } else {
                                        {
                                            let mut avg = crate::search::average_runs(&runs);
                                            avg.result["weaponAnalysis"] =
                                                crate::analysis::weapon_report(&avg);
                                            Ok(avg)
                                        }
                                    }
                                };
                                let result = result.map(|run| queued_run(run, state.stage));
                                if sender.send((i, r, result)).is_err() {
                                    break;
                                }
                            }
                        });
                    }
                    drop(sender);
                    let mut completed = HashSet::new();
                    let mut cursor = state.cursor;
                    let mut last = Instant::now();
                    let mut last_ranking = Instant::now();
                    while let Ok((i, r, outcome)) = receiver.recv() {
                        if i == usize::MAX {
                            control.store(2, Ordering::Relaxed);
                            return Err(anyhow::anyhow!(outcome.err().unwrap()));
                        }
                        match outcome {
                            Ok(mut run) => {
                                run.result["attacks"] = json!({});
                                if state.stage == 3 {
                                    db.put("run", &run.id, &run)?;
                                }
                                db.finite_put(&cp.id, state.stage, r, &run)?;
                                completed.insert(i);
                            }
                            Err(e) => {
                                if e != "interrupted" {
                                    cp.errors.push(e);
                                    control.store(1, Ordering::Relaxed);
                                }
                            }
                        }
                        while completed.remove(&cursor) {
                            cursor += 1
                        }
                        cp.finite.as_mut().unwrap().cursor = cursor;
                        cp.done = cursor;
                        cp.elapsed = base_elapsed + started.elapsed().as_secs_f64();
                        if last_ranking.elapsed() >= Duration::from_secs(60) {
                            cp.leaders =
                                top_rows(&db, &cp.id, state.stage, plans, settings, versions, cat)?;
                            last_ranking = Instant::now();
                        }
                        if last.elapsed() > Duration::from_secs(2) {
                            persist(&cp, home_ref)?;
                            snapshot(&cp, &progress);
                            last = Instant::now();
                        }
                    }
                    Ok(())
                })?;
                cp.elapsed = base_elapsed + started.elapsed().as_secs_f64();
                cp.leaders = top_rows(
                    &db,
                    &cp.id,
                    state.stage,
                    &state.plans,
                    &cp.settings,
                    &cp.versions,
                    &catalog,
                )?;
                if control.load(Ordering::Relaxed) != 0 {
                    cp.status = if control.load(Ordering::Relaxed) == 1 {
                        "已暂停"
                    } else {
                        "已取消"
                    }
                    .into();
                    persist(&cp, &home)?;
                    snapshot(&cp, &progress);
                    return Ok(());
                }
                if cp.done < total {
                    return Err(anyhow::anyhow!("有候选未完成，请从断点继续"));
                }
                if state.stage == 3 {
                    cp.status = if cp.leaders.iter().all(|r| r.metrics.eph == 0.) {
                        "比较完成：未找到可通关阵容"
                    } else {
                        "比较完成"
                    }
                    .into();
                    db.put("comparison", &cp.id, &thin_rows(&cp.leaders))?;
                    persist(&cp, &home)?;
                    let report = crate::workflow::Report::from_checkpoint(&cp, &db);
                    db.put("report", &cp.id, &report)?;
                    snapshot(&cp, &progress);
                    return Ok(());
                }
                let st = cp.finite.as_mut().unwrap();
                st.stage += 1;
                st.cursor = 0;
                st.selected.clear();
                st.selection_count = if st.stage == 2 {
                    db.finite_prepare_profession_selection(&cp.id, 2, 1, 50)?
                } else if st.stage == 3 {
                    db.finite_prepare_profession_selection(&cp.id, 3, 2, 10)?
                } else {
                    0
                };
                cp.round += 1;
                cp.composition_best = thin_rows(&cp.leaders);
                persist(&cp, &home)?;
            }
        })();
        if let Err(e) = outcome {
            cp.status = "失败：任务已保存，可检查后继续".into();
            cp.errors.push(e.to_string());
            let _ = persist(&cp, &home);
            snapshot(&cp, &progress);
        }
    });
}

pub fn candidate_count(size: usize, templates: &[Template], tier: usize, cat: &Value) -> usize {
    combinations(size)
        .into_iter()
        .map(|comb| {
            let base: Vec<_> = comb
                .iter()
                .map(|i| {
                    templates
                        .iter()
                        .find(|t| t.profession == CLASSES[*i] && t.tier == tier)
                        .unwrap()
                        .config
                        .clone()
                })
                .collect();
            plan(base, cat).count
        })
        .sum()
}

/// Restores the actual screen winner, including per-member food and its MP trigger.
pub fn restore_screen_config(configs: &mut [Value], payload: &Value, cat: &Value) {
    for (i, c) in configs.iter_mut().enumerate() {
        if let Some(drinks) = payload["drinks"][i].as_array() {
            let cups = drinks.iter().filter_map(Value::as_str).map(str::to_owned).collect::<Vec<_>>();
            crate::coffee::apply(c, &cups, cat);
        }
        if let Some(food) = payload["food"][i].as_array() {
            c["food"] = json!(food);
            for h in food.iter().filter_map(Value::as_str) {
                if c["triggerMap"].get(h).is_none() {
                    c["triggerMap"][h] = cat["items"][h]["consumableDetail"]["defaultCombatTriggers"].as_array().map(|t|json!(t)).unwrap_or(json!([]));
                }
            }
        }
    }
}

#[cfg(test)]
mod memory_tests {
    use super::*;
    #[test]
    fn stage_snapshots_share_large_plan_table_and_read_legacy_json() {
        let old=json!({"version":4,"stage":1,"cursor":123,"initial":456,"plans":[{"base":[],"regular":[],"auras":[],"count":456}],"selected":[],"selection_count":0,"durations":[1.,24.,48.]});
        let state:State=serde_json::from_value(old.clone()).unwrap();
        let copy=state.clone();
        assert!(Arc::ptr_eq(&state.plans,&copy.plans));
        assert_eq!(serde_json::to_value(state).unwrap(),old);
    }
    #[test]
    fn slow_writer_bounds_backlog_and_receiver_failure_unblocks_workers() {
        use std::sync::mpsc::TrySendError;
        let (sender,receiver)=result_channel(2);
        for i in 0..2 {sender.try_send((i,Ref::default(),Err("sample".into()))).unwrap();}
        assert!(matches!(sender.try_send((2,Ref::default(),Err("sample".into()))),Err(TrySendError::Full(_))));
        let sent=AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let sent=&sent;
            scope.spawn(move || {
                assert!(sender.send((2,Ref::default(),Err("sample".into()))).is_err());
                sent.fetch_add(1,Ordering::Relaxed);
            });
            drop(receiver);
        });
        assert_eq!(sent.load(Ordering::Relaxed),1);
    }
    #[test]
    fn compact_screen_preserves_database_payload_and_final_reports() {
        let res=crate::runtime::resource_dir();
        let ts:Vec<Template>=serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
        let run=Run{id:"memory".into(),configs:vec![ts[0].config.clone()],settings:Settings::default(),metrics:Metrics{eph:123.,player_dps:vec![456.],..Default::default()},result:json!({"compiledScenario":"x".repeat(2_000_000),"coffeeAdjustment":{"selectedDrinks":[1]},"foodAdjustment":{"selectedFood":[2]}}),versions:json!({}),seeds:vec![],ci95:0.,seed_runs:vec![]};
        let cp=queued_run(run.clone(),1);
        assert!(serde_json::to_vec(&cp).unwrap().len()<50_000);
        assert_eq!(cp.configs,run.configs);assert_eq!(cp.metrics.eph,123.);assert_eq!(cp.result["coffeeAdjustment"],run.result["coffeeAdjustment"]);assert_eq!(cp.result["foodAdjustment"],run.result["foodAdjustment"]);
        assert_eq!(queued_run(run.clone(),3).result,run.result);
        let home=std::env::temp_dir().join(format!("lineup-memory-{}",chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let db=Store::open(&home.join("test.sqlite")).unwrap();db.finite_init().unwrap();
        db.finite_put("old",1,Ref::default(),&run).unwrap();db.finite_put("new",1,Ref::default(),&cp).unwrap();
        assert_eq!(db.finite_coffee("old",1,0).unwrap(),db.finite_coffee("new",1,0).unwrap());
        let a=db.finite_top("old",1,1,None,false,0).unwrap();let b=db.finite_top("new",1,1,None,false,0).unwrap();assert_eq!(serde_json::to_value(&a[0].1).unwrap(),serde_json::to_value(&b[0].1).unwrap());
        drop(db);std::fs::remove_dir_all(home).unwrap();
    }
}
