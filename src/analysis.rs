use crate::model::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;
const EFFECTS: [(&str, &str); 9] = [
    ("curse", "诅咒伤害归因"),
    ("pierce", "穿透连击"),
    ("ripple", "涟漪"),
    ("blaze", "烈焰追加"),
    ("bloom", "绽放"),
    ("parry", "招架"),
    ("mayhem", "混乱重试"),
    ("fury", "愤怒叠层"),
    ("weaken", "虚弱"),
];
pub fn weapon_report(run: &Run) -> Value {
    let samples: Vec<&Run> = if run.seed_runs.is_empty() {
        vec![run]
    } else {
        run.seed_runs.iter().collect()
    };
    let mut report = report_samples(run, &samples, None);
    let mut phases = BTreeMap::new();
    for s in &samples {
        for h in s.result["phaseWeaponEffects"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(h, _)| h)
        {
            phases.entry(h.clone()).or_insert(Value::Null);
        }
    }
    for (h, v) in &mut phases {
        *v = report_samples(run, &samples, Some(h));
    }
    report["phases"] = json!(phases);
    report
}
fn report_samples(run: &Run, samples: &[&Run], phase: Option<&str>) -> Value {
    let n = samples.len() as f64;
    let seconds = samples
        .iter()
        .map(|r| {
            phase
                .map(|p| r.result["phaseSeconds"][p].as_f64().unwrap_or(0.))
                .unwrap_or(r.metrics.hours * 3600.)
        })
        .sum::<f64>()
        .max(1e-9);
    let player_damage = |i: usize| {
        samples
            .iter()
            .map(|r| {
                phase
                    .map(|p| r.result["phaseDamage"][p][i].as_f64().unwrap_or(0.))
                    .unwrap_or(
                        r.metrics.player_dps.get(i).copied().unwrap_or(0.)
                            * r.metrics.hours
                            * 3600.,
                    )
            })
            .sum::<f64>()
    };
    let team_damage = (0..run.configs.len()).map(player_damage).sum::<f64>();
    let mut rows = Vec::new();
    for i in 0..run.configs.len() {
        let equipped = &run.result["compiledScenario"]["players"][i]["equipStats"];
        let enabled: Vec<_> = EFFECTS
            .iter()
            .filter(|(key, _)| equipped[*key].as_f64().unwrap_or(0.) > 0.)
            .collect();
        if enabled.is_empty() {
            continue;
        }
        let mut totals = serde_json::Map::new();
        for r in samples {
            let counters = phase
                .map(|p| &r.result["phaseWeaponEffects"][p][i])
                .unwrap_or(&r.result["weaponEffects"][i]);
            for (k, v) in counters.as_object().into_iter().flatten() {
                let old = totals.get(k).and_then(Value::as_f64).unwrap_or(0.);
                totals.insert(k.clone(), json!(old + v.as_f64().unwrap_or(0.)));
            }
        }
        let get = |h: &str| totals.get(h).and_then(Value::as_f64).unwrap_or(0.);
        let damage = player_damage(i);
        let mut transferred = 0.;
        let mut out = 0.;
        let mut teammate_damage = 0.;
        let mut teammates = vec![];
        for j in 0..run.configs.len() {
            if i == j {
                continue;
            }
            let amount = samples
                .iter()
                .map(|r| {
                    phase
                        .map(|p| r.result["phaseTransfers"][p][j][i].as_f64().unwrap_or(0.))
                        .unwrap_or(r.result["curseTransfers"][j][i].as_f64().unwrap_or(0.))
                })
                .sum::<f64>();
            let outgoing = samples
                .iter()
                .map(|r| {
                    phase
                        .map(|p| r.result["phaseTransfers"][p][i][j].as_f64().unwrap_or(0.))
                        .unwrap_or(r.result["curseTransfers"][i][j].as_f64().unwrap_or(0.))
                })
                .sum::<f64>();
            transferred += amount;
            out += outgoing;
            teammate_damage += player_damage(j);
            teammates.push(json!({"slot":j,"damage":amount/n,"dps":amount/seconds,"share":amount/player_damage(j).max(1e-9)}));
        }
        let mut effects = vec![];
        let v2 = samples
            .iter()
            .all(|r| r.result["weaponObservationVersion"].as_u64().unwrap_or(0) >= 2);
        for &&(key, name) in &enabled {
            let mut e = match key {
                "curse" => {
                    let mut hits = 0.;
                    let mut layers = 0.;
                    let mut full = 0.;
                    for r in samples {
                        if let Some(p) = phase {
                            for w in r.result["phaseWeaponEffects"][p]
                                .as_array()
                                .into_iter()
                                .flatten()
                            {
                                hits += w["curse_hit_count"].as_f64().unwrap_or(0.);
                                layers += w["curse_hit_layers"].as_f64().unwrap_or(0.);
                                full += w["curse_full_hits"].as_f64().unwrap_or(0.);
                            }
                        } else {
                            for h in r.result["curseDirectHitHistogramByPlayer"]
                                .as_array()
                                .into_iter()
                                .flatten()
                            {
                                for (k, v) in h.as_array().into_iter().flatten().enumerate() {
                                    let x = v.as_f64().unwrap_or(0.);
                                    hits += x;
                                    layers += x * k as f64;
                                    if k == 5 {
                                        full += x;
                                    }
                                }
                            }
                        }
                    }
                    json!({"damage":transferred/n,"dps":transferred/seconds,"rawDps":damage/seconds,"attributedDps":(damage+transferred-out)/seconds,"teammateShare":transferred/teammate_damage.max(1e-9),"teamShare":transferred/team_damage.max(1e-9),"teammates":teammates,"hitLayers":if hits>0.{json!(layers/hits)}else{Value::Null},"fullHitShare":if hits>0.{json!(full/hits)}else{Value::Null}})
                }
                "pierce" => {
                    json!({"triggers":get("pierce_triggers")/n,"extraHits":get("pierce_hits")/get("pierce_triggers").max(1.),"targetsPerTrigger":1.+get("pierce_targets")/get("pierce_triggers").max(1.),"hitsPerTrigger":1.+get("pierce_hits")/get("pierce_triggers").max(1.),"damage":get("pierce_damage")/n,"dps":get("pierce_damage")/seconds,"personalShare":get("pierce_damage")/damage.max(1.),"teamShare":get("pierce_damage")/team_damage.max(1.)})
                }
                "ripple" => {
                    let mut cooldowns: BTreeMap<String, (f64, f64, f64)> = BTreeMap::new();
                    for r in samples {
                        for (p, rows) in r.result["rippleCooldowns"]
                            .as_object()
                            .into_iter()
                            .flatten()
                        {
                            if phase.is_some_and(|phase| phase != p) {
                                continue;
                            }
                            for row in rows
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter(|row| row["slot"] == i)
                            {
                                let a = cooldowns
                                    .entry(row["ability"].as_str().unwrap_or("").into())
                                    .or_default();
                                a.0 += row["seconds"].as_f64().unwrap_or(0.);
                                a.1 += row["originalSeconds"].as_f64().unwrap_or(0.);
                                a.2 += row["count"].as_f64().unwrap_or(0.);
                            }
                        }
                    }
                    json!({"cooldowns":if v2{json!(cooldowns.iter().map(|(h,(seconds,original,count))|json!({"ability":h,"name":ability_name(h),"meanSeconds":seconds/count.max(1.),"ratio":seconds/original.max(1e-9),"cycles":count/n})).collect::<Vec<_>>())}else{Value::Null}})
                }
                "blaze" => {
                    json!({"triggers":get("blaze_triggers")/n,"damage":get("blaze_damage")/n,"dps":get("blaze_damage")/seconds,"personalShare":get("blaze_damage")/damage.max(1.)})
                }
                "bloom" => {
                    let receivers = if phase.is_none() {
                        json!((0..run.configs.len()).map(|j|json!({"slot":j,"healing":samples.iter().map(|r|r.result["bloomReceivers"][i][j].as_f64().unwrap_or(0.)).sum::<f64>()/n})).collect::<Vec<_>>())
                    } else {
                        Value::Null
                    };
                    json!({"triggers":get("bloom_triggers")/n,"effectiveHealing":get("bloom_healing")/n,"healingPerTrigger":get("bloom_healing")/get("bloom_triggers").max(1.),"overhealShare":if v2{json!((get("bloom_attempted")-get("bloom_healing")).max(0.)/get("bloom_attempted").max(1.))}else{Value::Null},"healingShare":if v2{json!(get("bloom_healing")/get("total_healing").max(1.))}else{Value::Null},"receivers":receivers})
                }
                "parry" => {
                    json!({"triggers":get("parries")/n,"damage":get("parry_damage")/n,"dps":get("parry_damage")/seconds,"personalShare":get("parry_damage")/damage.max(1.),"preventedDamage":if v2{json!(get("parry_prevented")/n)}else{Value::Null},"preventionShare":if v2{json!(get("parry_prevented")/(get("team_taken")+get("parry_prevented")).max(1.))}else{Value::Null},"targets":if v2&&phase.is_none(){json!((0..run.configs.len()).map(|j|json!({"slot":j,"count":samples.iter().map(|r|r.result["parryTargets"][i][j].as_f64().unwrap_or(0.)).sum::<f64>()/n})).collect::<Vec<_>>())}else{Value::Null}})
                }
                "mayhem" => {
                    json!({"triggers":get("mayhem_triggers")/n,"extraHits":get("retry_hits")/n,"damage":get("retry_damage")/n,"dps":get("retry_damage")/seconds,"personalShare":get("retry_damage")/damage.max(1.)})
                }
                "fury" => {
                    json!({"events":get("fury_events")/n,"meanLayers":get("fury_layer_seconds")/get("alive_seconds").max(1e-9),"fullUptime":get("fury_full_seconds")/get("alive_seconds").max(1e-9),"hitLayers":if v2{json!(get("fury_hit_layers")/get("fury_hit_count").max(1.))}else{Value::Null},"dps":if v2{json!(get("fury_bonus_damage")/seconds)}else{Value::Null},"gainShare":if v2{json!(get("fury_bonus_damage")/get("fury_baseline_damage").max(1.))}else{Value::Null},"damageByLayer":if v2&&phase.is_none(){json!((0..6).map(|k|samples.iter().map(|r|r.result["furyDamageLayers"][i][k].as_f64().unwrap_or(0.)).sum::<f64>()/n).collect::<Vec<_>>())}else{Value::Null}})
                }
                "weaken" => {
                    json!({"applications":get("weaken_applications")/n,"meanLayers":get("weaken_layer_seconds")/get("target_seconds").max(1e-9),"fullUptime":get("weaken_max_seconds")/get("target_seconds").max(1e-9),"preventedDamage":if v2{json!(get("weaken_prevented")/n)}else{Value::Null},"preventionShare":if v2{json!(get("weaken_prevented")/(get("team_taken")+get("weaken_prevented")).max(1.))}else{Value::Null}})
                }
                _ => json!({}),
            };
            e["effect"] = json!(name);
            e["key"] = json!(key);
            effects.push(e);
        }
        let mut row = json!({"slot":i,"profession":run.configs[i]["name"],"weapon":run.configs[i]["equipment"]["weapon"],"statistics":effects.first(),"effects":effects,"rawCountersTotalAcrossSeeds":totals});
        if !v2 {
            row["incomplete"] = json!(true);
        }
        rows.push(row);
    }
    json!({"schemaVersion":2,"seeds":samples.len(),"hoursPerSeed":seconds/n/3600.,"players":rows})
}
fn ability_name(h: &str) -> String {
    static NAMES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let names = NAMES.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/ui-names.json")).unwrap_or(Value::Null)
    });
    let slug = h.strip_prefix("/abilities/").unwrap_or(h);
    let english = slug
        .split('_')
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    names[h]
        .as_str()
        .or_else(|| names[&english].as_str())
        .unwrap_or(&english)
        .into()
}
