use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
pub const ENGINE_VERSION: &str = "lineup-rust-0.1.0+20261030.9";
pub const CLASSES: [&str; 9] = [
    "water", "fire", "nature", "sword", "mace", "spear", "bow", "crossbow", "shield",
];
pub const NAMES: [&str; 9] = ["水", "火", "自然", "剑", "锤", "枪", "弓", "弩", "盾"];
pub fn label(c: &str) -> &str {
    CLASSES
        .iter()
        .position(|x| *x == c)
        .map(|i| NAMES[i])
        .unwrap_or(c)
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub profession: String,
    pub tier: usize,
    pub version: u64,
    pub config: Value,
    pub provenance: Value,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    pub zone: String,
    pub tier: u32,
    pub hours: f64,
    pub seed: u64,
    pub budget_hours: f64,
    pub tier_template: usize,
    pub minimum: [usize; 9],
    pub maximum: [usize; 9],
    pub fixed: Vec<Value>,
    pub workers: usize,
    #[serde(default = "default_seeds")]
    pub comparison_seeds: usize,
}
fn default_seeds() -> usize {
    8
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            zone: "/actions/combat/pirate_cove".into(),
            tier: 1,
            hours: 48.,
            seed: 20261028,
            budget_hours: 8.,
            tier_template: 1,
            minimum: [0; 9],
            maximum: [5; 9],
            fixed: vec![],
            comparison_seeds: 8,
            workers: ((std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                * 3)
                / 4)
            .max(1),
        }
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Metrics {
    pub eph: f64,
    pub failure: f64,
    pub deaths: f64,
    pub dps: f64,
    pub hours: f64,
    pub completed: f64,
    pub failed: f64,
    pub mana: f64,
    pub consumables: f64,
    pub xp: f64,
    pub player_dps: Vec<f64>,
    #[serde(default)]
    pub member_deaths_per_hour: Vec<f64>,
    #[serde(default)]
    pub member_mana_shortage: Vec<bool>,
    #[serde(default)]
    pub ranked_hours: f64,
    #[serde(default)]
    pub unfinished_hours: f64,
    #[serde(default)]
    pub failed_hours: f64,
}
fn sum(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.),
        Value::Object(m) => m.values().map(sum).sum(),
        Value::Array(a) => a.iter().map(sum).sum(),
        _ => 0.,
    }
}
fn ranked_hours(r: &Value, hours: f64) -> f64 {
    if r["isDungeon"] == true {
        r["finishedAttemptSeconds"]
            .as_f64()
            .map(|s| (s / 3600.).max(1e-9))
            .unwrap_or(hours)
    } else {
        hours
    }
}
pub fn metrics(r: &Value, n: usize) -> Metrics {
    let hours = (r["simulatedTime"].as_f64().unwrap_or(0.) / 3600e9).max(1e-9);
    let completed = r[if r["isDungeon"].as_bool().unwrap_or(false) {
        "dungeonsCompleted"
    } else {
        "encounters"
    }]
    .as_f64()
    .unwrap_or(0.);
    let failed = r["dungeonsFailed"].as_f64().unwrap_or(0.);
    let mut damage = vec![0.; n];
    if let Some(rows) = r["damageTotals"].as_array() {
        for row in rows {
            let src = row["source"].as_str().unwrap_or("");
            if !row["target"].as_str().unwrap_or("").starts_with("player") {
                for i in 0..n {
                    if src == format!("player{}", i + 1) {
                        damage[i] += row["damage"].as_f64().unwrap_or(0.);
                    }
                }
            }
        }
    }
    let player_dps: Vec<_> = damage.into_iter().map(|d| d / (hours * 3600.)).collect();
    Metrics {
        member_deaths_per_hour: (0..n)
            .map(|i| sum(&r["deaths"][format!("player{}", i + 1)]) / hours)
            .collect(),
        member_mana_shortage: (0..n)
            .map(|i| r["playerRanOutOfMana"][format!("player{}", i + 1)] == true)
            .collect(),
        eph: completed / ranked_hours(r, hours),
        ranked_hours: ranked_hours(r, hours),
        unfinished_hours: r["unfinishedAttemptSeconds"].as_f64().unwrap_or(0.) / 3600.,
        failed_hours: r["dungeonAttemptDurations"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|a| a["successful"] == false)
            .map(|a| a["seconds"].as_f64().unwrap_or(0.) / 3600.)
            .sum(),
        failure: if completed + failed > 0. {
            failed / (completed + failed)
        } else {
            0.
        },
        deaths: r["deaths"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.iter())
            .filter(|(k, _)| k.starts_with("player"))
            .map(|(_, v)| sum(v))
            .sum::<f64>()
            / hours,
        dps: player_dps.iter().sum(),
        hours,
        completed,
        failed,
        mana: sum(&r["manaUsed"]) / hours,
        consumables: sum(&r["consumablesUsed"]) / hours,
        xp: sum(&r["experienceGained"]) / hours,
        player_dps,
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub configs: Vec<Value>,
    pub settings: Settings,
    pub metrics: Metrics,
    pub result: Value,
    pub versions: Value,
    pub seeds: Vec<f64>,
    pub ci95: f64,
    #[serde(default)]
    pub seed_runs: Vec<Run>,
}
pub fn remove_task_badges(config: &mut Value) {
    if let Some(equipment) = config["equipment"].as_object_mut() {
        equipment.retain(|slot, item| {
            slot != "trinket"
                && !item["itemHrid"]
                    .as_str()
                    .unwrap_or("")
                    .contains("task_badge")
        });
    }
}
pub fn digest(v: &impl Serialize) -> String {
    hex::encode(Sha256::digest(serde_json::to_vec(v).unwrap()))
}
pub fn versions(data: &Value, templates: &[Template]) -> Value {
    json!({"schema":1,"engine":ENGINE_VERSION,"searchPolicy":crate::finite::RULES_VERSION,"dataVersion":data["gameVersion"],"dataHash":digest(data),"templatesHash":digest(&templates),"searchRulesHash":std::fs::read(crate::runtime::resource_dir().join("search-pools.json")).ok().map(|b|hex::encode(Sha256::digest(&b)))})
}
pub fn rank(a: &Run, b: &Run) -> std::cmp::Ordering {
    b.metrics
        .eph
        .total_cmp(&a.metrics.eph)
        .then(a.metrics.failure.total_cmp(&b.metrics.failure))
        .then(a.metrics.deaths.total_cmp(&b.metrics.deaths))
}
pub fn mean_ci(v: &[f64]) -> (f64, f64) {
    let n = v.len() as f64;
    if n == 0. {
        return (0., 0.);
    }
    let mean = v.iter().sum::<f64>() / n;
    if n < 2. {
        return (mean, 0.);
    }
    let var = v.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.);
    let t = match v.len() {
        2 => 12.706,
        3 => 4.303,
        4 => 3.182,
        5 => 2.776,
        6 => 2.571,
        7 => 2.447,
        8 => 2.365,
        _ => 1.96,
    };
    (mean, t * (var / n).sqrt())
}
pub fn combinations(n: usize) -> Vec<Vec<usize>> {
    fn rec(start: usize, n: usize, v: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if n == 0 {
            out.push(v.clone());
            return;
        }
        for c in start..9 {
            v.push(c);
            rec(c, n - 1, v, out);
            v.pop();
        }
    }
    let mut out = vec![];
    rec(0, n, &mut vec![], &mut out);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enumeration() {
        assert_eq!(combinations(3).len(), 165);
        assert_eq!(combinations(5).len(), 1287);
        assert!(combinations(5).contains(&vec![8; 5]));
    }
    #[test]
    fn failed_time() {
        let r = json!({"simulatedTime":7200e9,"isDungeon":true,"dungeonsCompleted":3,"dungeonsFailed":1});
        let m = metrics(&r, 5);
        assert_eq!(m.eph, 1.5);
        assert_eq!(m.failure, 0.25)
    }
    #[test]
    fn player_deaths_exclude_monsters() {
        let r = json!({"simulatedTime":3600e9,"deaths":{"player1":2,"/monsters/eye":1000}});
        assert_eq!(metrics(&r, 3).deaths, 2.);
    }
    #[test]
    fn confidence() {
        assert_eq!(mean_ci(&[3.; 8]), (3., 0.));
        assert!(mean_ci(&[1., 2., 3., 4., 5., 6., 7., 8.]).1 > 0.);
    }
    #[test]
    fn cache_versions() {
        assert_ne!(digest(&json!({"engine":1})), digest(&json!({"engine":2})));
    }
}

/// Applying a new default must not depend on the user's template edit revision.
pub fn set_preset_shrines(templates: &mut [Template], guild_buffs: &Value) {
    for t in templates {
        t.config["guildBuffs"] = guild_buffs.clone();
        t.version = t.version.max(6);
    }
}
