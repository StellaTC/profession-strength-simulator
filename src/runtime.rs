use crate::model::*;
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
};
pub fn resource_dir() -> PathBuf {
    if let Ok(p) = std::env::var("LINEUP_RESOURCES") {
        return p.into();
    }
    let exe = std::env::current_exe().unwrap();
    let p = exe.parent().unwrap().join("../Resources");
    if p.join("game-data.json").exists() {
        p
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    }
}
pub fn user_dir() -> PathBuf {
    if let Ok(p) = std::env::var("LINEUP_HOME") {
        return p.into();
    }
    PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/阵容战斗模拟器")
}
pub struct Adapter {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Adapter {
    pub fn new(resources: &Path, data: &Path) -> Result<Self> {
        let mut child = Command::new(resources.join("runtime/node"))
            .arg(resources.join("adapter.mjs"))
            .arg(data)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        })
    }
    pub fn request(&mut self, v: Value) -> Result<Value> {
        writeln!(self.input, "{}", v)?;
        self.input.flush()?;
        let mut line = String::new();
        self.output.read_line(&mut line)?;
        let r: Value = serde_json::from_str(&line)?;
        if r["ok"] != true {
            return Err(anyhow!("{}", r["error"]));
        }
        let mut result = r["result"].clone();
        if result["items"].is_object() {
            if let Ok(bytes) = std::fs::read(resource_dir().join("search-pools.json")) {
                if let Ok(pools) = serde_json::from_slice::<Value>(&bytes) {
                    result["searchPools"] = pools;
                }
            }
            if let Ok(bytes) = std::fs::read(resource_dir().join("ui-names.json")) {
                if let Ok(names) = serde_json::from_slice::<Value>(&bytes) {
                    for field in [
                        "abilities",
                        "items",
                        "monsters",
                        "houseRooms",
                        "guildBuffs",
                        "achievements",
                        "triggerDependencies",
                        "triggerConditions",
                        "triggerComparators",
                    ] {
                        if let Some(map) = result[field].as_object_mut() {
                            for (h, v) in map {
                                let old = v["name"].as_str().unwrap_or("");
                                if let Some(n) = names[h].as_str().or_else(|| names[old].as_str()) {
                                    v["englishName"] = json!(old);
                                    v["name"] = json!(n);
                                }
                            }
                        }
                    }
                    if let Some(zones) = result["zones"].as_array_mut() {
                        for z in zones {
                            let h = z["hrid"].as_str().unwrap_or("");
                            let old = z["name"].as_str().unwrap_or("");
                            if let Some(n) = names[h].as_str().or_else(|| names[old].as_str()) {
                                z["englishName"] = json!(old);
                                z["name"] = json!(n);
                            }
                        }
                    }
                }
            }
        }
        Ok(result)
    }
}
impl Drop for Adapter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub struct Runtime {
    pub adapter: Adapter,
    pub data: mwi_engine::data::GameData,
    pub versions: Value,
    items: Value,
}
impl Runtime {
    pub fn new(resources: &Path, data: &Path, versions: Value) -> Result<Self> {
        let mut adapter = Adapter::new(resources, data)?;
        let raw: Value = serde_json::from_slice(&std::fs::read(data)?)?;
        let items = if raw["maps"].is_object() {
            raw["maps"]["itemDetailMap"].clone()
        } else {
            raw["itemDetailMap"].clone()
        };
        let gd = adapter.request(json!({"op":"data"}))?;
        let data = mwi_engine::data::GameData::from_json(&gd).map_err(|e| anyhow!(e))?;
        Ok(Self {
            adapter,
            data,
            versions,
            items,
        })
    }
    pub fn run(
        &mut self,
        mut configs: Vec<Value>,
        settings: &Settings,
        control: &Arc<AtomicU8>,
        detailed: bool,
    ) -> Result<Run> {
        for c in &mut configs {
            remove_task_badges(c);
        }
        let mut sc=self.adapter.request(json!({"configs":configs,"zone":settings.zone,"tier":settings.tier,"hours":settings.hours,"seed":settings.seed}))?;
        sc["observeWeapons"] = json!(detailed || settings.hours >= 48.);
        let mut sim =
            mwi_engine::sim::Sim::new(&self.data, &sc, detailed).map_err(|e| anyhow!(e))?;
        sim.simulate_controlled(settings.hours * 3600e9, &|| {
            control.load(Ordering::Relaxed) == 0
        })
        .map_err(|e| anyhow!(e))?;
        let mut result = sim.result_json();
        result["compiledScenario"] = sc.clone();
        let mut equipment = serde_json::Map::new();
        for c in &configs {
            for (_, v) in c["equipment"].as_object().into_iter().flatten() {
                if let Some(h) = v["itemHrid"].as_str() {
                    equipment.insert(h.to_owned(), self.items[h].clone());
                }
            }
        }
        result["equipmentSnapshot"] = json!(equipment);
        let metrics = metrics(&result, configs.len());
        let id = format!(
            "{}-{}",
            chrono::Utc::now().timestamp_millis(),
            &digest(&sc)[..10]
        );
        Ok(Run {
            id,
            configs,
            settings: settings.clone(),
            metrics,
            result,
            versions: self.versions.clone(),
            seeds: vec![],
            ci95: 0.,
            seed_runs: vec![],
        })
    }
}
