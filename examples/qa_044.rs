//! Real short-run data only, in an isolated UI QA database. Not final search results.
use lineup_simulator::{model::*,runtime::*,search,store::Store,workflow::*};
use serde_json::{Value,json};use std::sync::{Arc,atomic::AtomicU8};
fn main()->anyhow::Result<()> {
 let home=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("work/ui044-home");std::fs::create_dir_all(&home)?;
 let db=Store::open(&home.join("simulator.sqlite"))?;let res=resource_dir();
 let templates:Vec<Template>=serde_json::from_slice(&std::fs::read(res.join("templates.json"))?)?;
 let data:Value=serde_json::from_slice(&std::fs::read(res.join("game-data.json"))?)?;let ver=versions(&data,&templates);
 let mut rt=Runtime::new(&res,&res.join("game-data.json"),ver.clone())?;let ctl=Arc::new(AtomicU8::new(0));
 for zone in ["golem_cave","twilight_zone","infernal_abyss"] {for tier in [0,1] {
  let id=format!("qa044-{zone}-{tier}");let mut runs=vec![];
  for n in 0..10 {
   let classes=if n==9 {vec!["water","water","water"]}else{vec!["water",CLASSES[(n+1)%9],CLASSES[(n+3)%9]]};
   let configs=classes.iter().map(|c|templates.iter().find(|t|t.profession==*c&&t.tier==1).unwrap().config.clone()).collect();
   let settings=Settings{zone:format!("/actions/combat/{zone}"),tier,hours:0.02,..Default::default()};
   let mut run=rt.run(configs,&settings,&ctl,true)?;run.id=format!("{id}-{n}");db.put("run",&run.id,&run)?;runs.push(run);
  }
  db.put("comparison",&id,&search::thin_rows(&runs))?;
  db.put("report",&id,&Report{id:id.clone(),settings:runs[0].settings.clone(),versions:ver.clone(),status:"比较完成（界面验收样本，非终测）".into(),finished:chrono::Utc::now().to_rfc3339(),runs:runs.iter().map(|r|r.id.clone()).collect()})?;
 }}println!("{}",home.display());Ok(())
}
