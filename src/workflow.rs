use crate::{model::*, search::Checkpoint, store::Store};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PLANETS: [&str; 5] = [
    "sorcerers_tower",
    "bear_with_it",
    "golem_cave",
    "twilight_zone",
    "infernal_abyss",
];
pub fn planet_allowed(hrid: &str) -> bool {
    PLANETS
        .iter()
        .any(|s| hrid == format!("/actions/combat/{s}"))
}
pub fn number(x: f64) -> String {
    if !x.is_finite() {
        return "—".into();
    }
    let s = format!("{:.2}", if x.abs() < 0.005 { 0. } else { x });
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}
pub fn change(a: f64, b: f64) -> Option<f64> {
    if a == 0. {
        None
    } else {
        Some((b - a) / a * 100.)
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub enum QueueStatus {
    Pending,
    Running,
    Paused,
    Cancelled,
    Failed,
    Completed,
    Skipped,
}
impl QueueStatus {
    pub fn label(&self) -> &str {
        match self {
            Self::Pending => "待运行",
            Self::Running => "运行中",
            Self::Paused => "已暂停",
            Self::Cancelled => "已取消",
            Self::Failed => "失败",
            Self::Completed => "已完成",
            Self::Skipped => "已跳过",
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub checkpoint: Checkpoint,
    pub data_file: String,
    pub catalog: Value,
    pub status: QueueStatus,
    pub error: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Queue {
    pub items: Vec<QueueItem>,
    pub enabled: bool,
}
impl Queue {
    pub fn recover(&mut self) {
        self.enabled = false;
        for i in &mut self.items {
            if i.status == QueueStatus::Running {
                i.status = QueueStatus::Paused;
            }
        }
    }
    pub fn next(&self) -> Option<usize> {
        self.items
            .iter()
            .position(|i| i.status == QueueStatus::Pending)
    }
    pub fn move_item(&mut self, from: usize, to: usize) {
        if from < self.items.len()
            && to < self.items.len()
            && self.items[from].status == QueueStatus::Pending
            && self.items[to].status == QueueStatus::Pending
        {
            self.items.swap(from, to);
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Report {
    pub id: String,
    pub settings: Settings,
    pub versions: Value,
    pub status: String,
    pub finished: String,
    pub runs: Vec<String>,
}
impl Report {
    pub fn complete(&self) -> bool {
        self.status.starts_with("比较完成")
    }
    pub fn from_checkpoint(cp: &Checkpoint, db: &Store) -> Self {
        let runs: Vec<Run> = db
            .get("comparison", &cp.id)
            .ok()
            .flatten()
            .unwrap_or_default();
        Self {
            id: cp.id.clone(),
            settings: cp.settings.clone(),
            versions: cp.versions.clone(),
            status: cp.status.clone(),
            finished: chrono::Utc::now().to_rfc3339(),
            runs: runs.iter().map(|r| r.id.clone()).collect(),
        }
    }
    pub fn load(&self, db: &Store) -> Vec<Run> {
        self.runs
            .iter()
            .filter_map(|id| db.get("run", id).ok().flatten())
            .collect()
    }
}
pub fn top<'a>(runs: &'a [Run], class: usize, dps: bool, n: usize) -> Vec<&'a Run> {
    let mut rs: Vec<_> = runs
        .iter()
        .filter(|r| r.configs.iter().any(|c| c["name"] == CLASSES[class]))
        .collect();
    rs.sort_by(|a, b| {
        if dps {
            crate::search::profession_dps(b, CLASSES[class])
                .total_cmp(&crate::search::profession_dps(a, CLASSES[class]))
                .then(crate::model::rank(a, b))
        } else {
            crate::model::rank(a, b)
        }
    });
    rs.truncate(n);
    rs
}

/// Notes are member based. An empty vector means legacy data, not evidence of zero events.
pub fn notes(run: &Run) -> (Vec<(usize, f64)>, Vec<usize>) {
    let owned;
    let samples: Vec<&Run> = if !run.seed_runs.is_empty() {
        run.seed_runs.iter().collect()
    } else {
        vec![run]
    };
    owned = samples
        .iter()
        .map(|r| {
            if r.metrics.member_deaths_per_hour.is_empty() && r.result.is_object() {
                metrics(&r.result, r.configs.len())
            } else {
                r.metrics.clone()
            }
        })
        .collect::<Vec<_>>();
    let hours = owned.iter().map(|m| m.hours).sum::<f64>().max(1e-9);
    let deaths = (0..run.configs.len())
        .filter_map(|i| {
            let rate = owned
                .iter()
                .map(|m| m.member_deaths_per_hour.get(i).copied().unwrap_or(0.) * m.hours)
                .sum::<f64>()
                / hours;
            if rate > 1. { Some((i, rate)) } else { None }
        })
        .collect();
    let mana = (0..run.configs.len())
        .filter(|i| {
            owned
                .iter()
                .any(|m| m.member_mana_shortage.get(*i) == Some(&true))
        })
        .collect();
    (deaths, mana)
}

/// Also discovers runs finished by an older application while this app is open.
pub fn sync_report_index(db: &Store) -> anyhow::Result<Vec<Report>> {
    let mut seen: std::collections::BTreeMap<String, String> =
        db.get("report-index", "stamps")?.unwrap_or_default();
    for (id, stamp) in db.record_stamps("checkpoint")? {
        if seen.get(&id) == Some(&stamp) {
            continue;
        }
        if let Some(cp) = db.get::<Checkpoint>("checkpoint", &id)? {
            if cp.comparison {
                let mut report = Report::from_checkpoint(&cp, db);
                report.finished = stamp.clone();
                db.put("report", &id, &report)?;
            }
        }
        seen.insert(id, stamp);
    }
    db.put("report-index", "stamps", &seen)?;
    db.list("report")
}

/// Restart the affected engine's finite job using its original immutable inputs.
/// The new ID isolates rankings and seed caches; old records remain available.
pub fn restart_after_cast_fix(item: &QueueItem, new_id: String) -> Option<QueueItem> {
    if item.checkpoint.versions["engine"] != "lineup-rust-0.1.0+20261029.8"
        || item.checkpoint.finite.as_ref()?.version != crate::finite::RULES_VERSION
        || matches!(item.status, QueueStatus::Running | QueueStatus::Completed | QueueStatus::Skipped)
    { return None; }
    let mut new=item.clone();
    let cp=&mut new.checkpoint;
    cp.versions["engine"]=serde_json::json!(ENGINE_VERSION);
    cp.versions["restartedFrom"]=serde_json::json!(cp.id);
    cp.id=new_id.clone();
    cp.elapsed=0.;cp.round=0;cp.done=0;
    cp.stage="职业阵容预览 · 1小时".into();cp.status="待运行".into();
    cp.pending.clear();cp.runs.clear();cp.leaders.clear();cp.composition_best.clear();cp.errors.clear();
    let state=cp.finite.as_mut().unwrap();
    state.stage=0;state.cursor=0;state.selected.clear();state.selection_count=0;
    cp.total=state.plans.len();
    new.id=new_id;new.status=QueueStatus::Pending;new.error.clear();
    Some(new)
}
