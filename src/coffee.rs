//! Attack-first coffee selection; excessive personal deaths replace critical with stamina.
use serde_json::{Value, json};
pub const CRITICAL: &str = "/items/critical_coffee";
pub const STAMINA: &str = "/items/ultra_stamina_coffee";
pub const ATTACK: &str = "/items/ultra_attack_coffee";
pub fn options(config: &Value, catalog: &Value) -> Vec<Vec<String>> {
    let weapon = config["equipment"]["weapon"]["itemHrid"]
        .as_str()
        .unwrap_or("");
    let primary = catalog["items"][weapon]["equipmentDetail"]["combatStats"]["primaryTraining"]
        .as_str()
        .unwrap_or("/skills/melee")
        .rsplit('/')
        .next()
        .unwrap_or("melee");
    let primary = if config["name"] == "spear" {
        "melee"
    } else {
        primary
    };
    let main = format!("/items/ultra_{primary}_coffee");
    let cls = config["name"].as_str().unwrap_or("");
    let speed = if ["water", "fire", "nature"].contains(&cls) {
        "/items/channeling_coffee"
    } else {
        "/items/swiftness_coffee"
    };
    [ATTACK, speed]
        .into_iter()
        .filter(|h| *h != main)
        .map(|h| vec![CRITICAL.to_string(), main.clone(), h.to_string()])
        .collect()
}
pub fn apply(config: &mut Value, drinks: &[String], catalog: &Value) {
    config["drinks"] = json!(drinks);
    for h in drinks {
        if config["triggerMap"].get(h).is_none() {
            let t = &catalog["items"][h]["consumableDetail"]["defaultCombatTriggers"];
            config["triggerMap"][h] = if t.is_array() { t.clone() } else { json!([]) };
        }
    }
}
pub fn death_rates(result: &Value, n: usize) -> Vec<f64> {
    let hours = (result["simulatedTime"].as_f64().unwrap_or(0.) / 3600e9).max(1e-9);
    (0..n)
        .map(|i| {
            result["deaths"][format!("player{}", i + 1)]
                .as_f64()
                .unwrap_or(0.)
                / hours
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rates_are_individual_and_exclude_monsters() {
        assert_eq!(
            death_rates(
                &json!({"simulatedTime":4.*3600e9,"deaths":{"player1":9,"player2":8,"/monsters/enemy":999}}),
                3
            ),
            vec![2.25, 2., 0.]
        );
    }
    #[test]
    fn required_cups_and_primary_attack_never_duplicate() {
        let res = crate::runtime::resource_dir();
        let templates: Vec<crate::model::Template> =
            serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
        let raw: Value =
            serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
        let cat = json!({"items":raw["itemDetailMap"]});
        for t in templates {
            let opts = options(&t.config, &cat);
            assert_eq!(opts.len(), 2);
            for cups in opts {
                assert_eq!(cups.len(), 3);
                assert_eq!(cups[0], CRITICAL);
                assert!(cups[1].starts_with("/items/ultra_"));
                assert_eq!(
                    cups.iter().collect::<std::collections::HashSet<_>>().len(),
                    3
                );
                assert!(!cups.contains(&"/items/lucky_coffee".to_string()));
                assert!(!cups.contains(&"/items/wisdom_coffee".to_string()));
            }
        }
    }
}
/// Adjust each member at most once, always using the current run's death rates.
pub fn next_survival_member(run: &crate::model::Run) -> Option<usize> {
    let rates = death_rates(&run.result, run.configs.len());
    (0..rates.len())
        .filter(|i| {
            rates[*i] > 2.
                && run.configs[*i]["drinks"].as_array().is_some_and(|d| {
                    d.iter().any(|h| h == CRITICAL) && !d.iter().any(|h| h == STAMINA)
                })
        })
        .max_by(|a, b| rates[*a].total_cmp(&rates[*b]).then_with(|| b.cmp(a)))
}
fn survive<F>(
    mut run: crate::model::Run,
    cat: &Value,
    runner: &mut F,
) -> anyhow::Result<(crate::model::Run, Vec<Value>, usize)>
where
    F: FnMut(Vec<Value>) -> anyhow::Result<crate::model::Run>,
{
    let mut changes = vec![];
    let mut simulations = 0;
    while let Some(i) = next_survival_member(&run) {
        let before = death_rates(&run.result, run.configs.len());
        let mut cfg = run.configs.clone();
        let drinks: Vec<String> = cfg[i]["drinks"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .map(|h| {
                if h == CRITICAL {
                    STAMINA.to_string()
                } else {
                    h.to_string()
                }
            })
            .collect();
        apply(&mut cfg[i], &drinks, cat);
        run = runner(cfg)?;
        simulations += 1;
        changes.push(json!({"member":i,"beforeDeathsPerHour":before,"afterDeathsPerHour":death_rates(&run.result,run.configs.len()),"replaced":CRITICAL,"replacement":STAMINA}));
    }
    Ok((run, changes, simulations))
}
/// Coffee selection is internal to the first screen and does not create extra external candidates.
pub fn screen_with<F>(
    mut configs: Vec<Value>,
    cat: &Value,
    mut runner: F,
) -> anyhow::Result<crate::model::Run>
where
    F: FnMut(Vec<Value>) -> anyhow::Result<crate::model::Run>,
{
    for c in &mut configs {
        let cups = options(c, cat);
        apply(c, &cups[0], cat);
    }
    let baseline = runner(configs.clone())?;
    let initial_rates = death_rates(&baseline.result, configs.len());
    let unsafe_baseline = initial_rates.iter().any(|v| *v > 2.);
    let mut simulations = 1;
    let (mut best, mut selected_changes, extra) = survive(baseline, cat, &mut runner)?;
    simulations += extra;
    let mut compared = 1;
    if !unsafe_baseline {
        let mut classes: Vec<String> = configs
            .iter()
            .filter_map(|c| c["name"].as_str().map(str::to_owned))
            .collect();
        classes.sort();
        classes.dedup();
        for mask in 1..(1usize << classes.len()) {
            let mut candidate = configs.clone();
            for c in &mut candidate {
                let cls = c["name"].as_str().unwrap();
                let bit = classes.iter().position(|v| v == cls).unwrap();
                let cups = options(c, cat);
                apply(c, &cups[((mask >> bit) & 1).min(cups.len() - 1)], cat);
            }
            let tested = runner(candidate)?;
            simulations += 1;
            compared += 1;
            let (tested, changes, extra) = survive(tested, cat, &mut runner)?;
            simulations += extra;
            if crate::model::rank(&tested, &best).is_lt() {
                best = tested;
                selected_changes = changes;
            }
        }
    }
    best.result["coffeeAdjustment"] = json!({"schemaVersion":1,"policy":"attack-first-personal-deaths-v1","baselineIndividualDeathsPerHour":initial_rates,"baselineTriggeredSurvival":unsafe_baseline,"comparedThirdCupChoices":compared,"screenSimulations":simulations,"changes":selected_changes,"selectedDrinks":best.configs.iter().map(|c|c["drinks"].clone()).collect::<Vec<_>>(),"remainingDeathsAboveThreshold":death_rates(&best.result,best.configs.len()).iter().enumerate().filter(|(_,v)|**v>2.).map(|(i,_)|i).collect::<Vec<_>>(),"selectionMetric":"EPH; failure and deaths break ties","scope":"只在1小时初筛选择；进入后续阶段后咖啡固定。首测不超标时逐职业比较第三杯，重复职业共用选择；耐力调整按个人。"});
    Ok(best)
}
pub fn screen(
    runtime: &mut crate::runtime::Runtime,
    configs: Vec<Value>,
    settings: &crate::model::Settings,
    control: &std::sync::Arc<std::sync::atomic::AtomicU8>,
    cat: &Value,
) -> anyhow::Result<crate::model::Run> {
    screen_with(configs, cat, |c| runtime.run(c, settings, control, false))
}
#[cfg(test)]
mod flow_tests {
    use super::*;
    use crate::model::*;
    fn setup(classes: &[&str]) -> (Vec<Value>, Value) {
        let res = crate::runtime::resource_dir();
        let t: Vec<Template> =
            serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
        let data: Value =
            serde_json::from_slice(&std::fs::read(res.join("game-data.json")).unwrap()).unwrap();
        (
            classes
                .iter()
                .map(|c| {
                    t.iter()
                        .find(|t| t.profession == *c && t.tier == 1)
                        .unwrap()
                        .config
                        .clone()
                })
                .collect(),
            json!({"items":data["itemDetailMap"]}),
        )
    }
    fn run(c: Vec<Value>, deaths: &[usize], eph: f64) -> Run {
        let mut d = serde_json::Map::new();
        for (i, n) in deaths.iter().enumerate() {
            d.insert(format!("player{}", i + 1), json!(n));
        }
        Run {
            id: "mock".into(),
            configs: c,
            settings: Settings::default(),
            metrics: Metrics {
                eph,
                ..Metrics::default()
            },
            result: json!({"simulatedTime":4.*3600e9,"deaths":d}),
            versions: json!({}),
            seeds: vec![],
            ci95: 0.,
            seed_runs: vec![],
        }
    }
    #[test]
    fn unsafe_baseline_replaces_critical_by_current_worst_and_skips_speed() {
        let (c, cat) = setup(&["water", "fire"]);
        let mut calls = 0;
        let result = screen_with(c, &cat, |c| {
            calls += 1;
            let deaths = match calls {
                1 => vec![20, 12],
                2 => vec![4, 16],
                3 => vec![4, 4],
                _ => panic!("unsafe baseline should not compare speed"),
            };
            Ok(run(c, &deaths, 10.))
        })
        .unwrap();
        assert_eq!(calls, 3);
        let changes = result.result["coffeeAdjustment"]["changes"]
            .as_array()
            .unwrap();
        assert_eq!(changes[0]["member"], 0);
        assert_eq!(changes[1]["member"], 1);
        for c in &result.configs {
            assert_eq!(c["drinks"][0], STAMINA);
            assert_eq!(c["drinks"][2], ATTACK);
        }
        assert_eq!(
            result.result["coffeeAdjustment"]["comparedThirdCupChoices"],
            1
        );
    }
    #[test]
    fn healthy_baseline_compares_third_cups_once_per_class_and_keeps_eph_winner() {
        let (c, cat) = setup(&["water", "water", "fire"]);
        let mut calls = 0;
        let result = screen_with(c, &cat, |c| {
            calls += 1;
            assert_eq!(c[0]["drinks"], c[1]["drinks"]);
            let score = 10.
                + c.iter()
                    .filter(|p| p["drinks"][2] == "/items/channeling_coffee")
                    .count() as f64;
            Ok(run(c, &[8, 0, 0], score))
        })
        .unwrap();
        assert_eq!(calls, 4);
        assert_eq!(result.metrics.eph, 13.);
        for c in &result.configs {
            assert_eq!(c["drinks"][0], CRITICAL);
            assert_eq!(c["drinks"][2], "/items/channeling_coffee");
        }
        assert_eq!(
            result.result["coffeeAdjustment"]["baselineTriggeredSurvival"],
            false
        );
    }
}
