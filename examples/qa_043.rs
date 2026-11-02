//! Disposable real-run fixtures and a queue for native 0.4.3 UI verification.
use lineup_simulator::{model::*,runtime::*,search,store::Store,workflow::*};
use serde_json::{Value,json};
use std::sync::{Arc,atomic::AtomicU8};
fn main()->anyhow::Result<()> {
 let home=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("work/ui043-home"); std::fs::create_dir_all(&home)?;
 let db=Store::open(&home.join("simulator.sqlite"))?;let res=resource_dir();
 let templates:Vec<Template>=serde_json::from_slice(&std::fs::read(res.join("templates.json"))?)?;
 let data:Value=serde_json::from_slice(&std::fs::read(res.join("game-data.json"))?)?;let ver=versions(&data,&templates);
 let mut runtime=Runtime::new(&res,&res.join("game-data.json"),ver.clone())?;let catalog=runtime.adapter.request(json!({"op":"catalog"}))?;
 let control=Arc::new(AtomicU8::new(0));
 for (i,classes) in [["water","bow","sword"],["fire","water","nature"]].into_iter().enumerate(){
  let cfg=classes.iter().map(|c|templates.iter().find(|t|t.profession==*c&&t.tier==1).unwrap().config.clone()).collect();
  let settings=Settings{zone:"/actions/combat/sorcerers_tower".into(),hours:0.1,..Default::default()};
  let mut run=runtime.run(cfg,&settings,&control,true)?; run.id=format!("qa043-run-{i}");let id=format!("qa043-report-{i}");
  db.put("run",&run.id,&run)?; db.put("comparison",&id,&search::thin_rows(&[run.clone()]))?;
  db.put("report",&id,&Report{id:id.clone(),settings,versions:ver.clone(),status:if i==0 {"比较完成（界面验收样本，非终测）"}else{"已暂停"}.into(),finished:chrono::Utc::now().to_rfc3339(),runs:vec![run.id]})?;
 }
 let mut settings=Settings{zone:"/actions/combat/sorcerers_tower".into(),workers:1,comparison_seeds:2,..Default::default()};
 settings.maximum=[0;9];for c in [0,3,6]{settings.maximum[c]=3;}settings.minimum[0]=1;
 let cp=search::comparison_checkpoint(settings,&templates,3,ver,&catalog);
 let file=home.join("game-data.json");std::fs::copy(res.join("game-data.json"),&file)?;
 let id=cp.id.clone();db.put("checkpoint",&id,&cp)?;
 let queue=Queue{items:vec![QueueItem{id:id.clone(),checkpoint:cp,data_file:file.display().to_string(),catalog,status:QueueStatus::Pending,error:String::new()}],enabled:false};
 db.put("ui-queue","active",&queue)?;println!("{}",home.display());Ok(())
}
