//! Isolated stress replay; never writes to the production database.
use lineup_simulator::{search::{Checkpoint,Progress},runtime::*,finite};
use serde_json::json;
use std::{sync::{Arc,Mutex,atomic::{AtomicU8,Ordering}},time::{Instant,Duration}};
fn main()->anyhow::Result<()> {
 let args:Vec<_>=std::env::args().collect();
 let mut cp:Checkpoint=serde_json::from_slice(&std::fs::read(&args[1])?)?;
 cp.id="memory-stress".into();cp.pending.clear();cp.runs.clear();cp.leaders.clear();cp.errors.clear();
 cp.settings.workers=7;
 let start=cp.finite.as_ref().unwrap().cursor;
 let home=std::path::PathBuf::from(&args[2]);std::fs::create_dir_all(&home)?;
 let res=resource_dir();let data=std::path::PathBuf::from(&args[3]);
 let mut adapter=Adapter::new(&res,&data)?;let cat=adapter.request(json!({"op":"catalog"}))?;drop(adapter);
 let control=Arc::new(AtomicU8::new(0));let progress=Arc::new(Mutex::new(Progress::default()));
 finite::start(cp,res,data,home,control.clone(),progress.clone(),cat);
 let now=Instant::now();let mut peak=0u64;let mut measurements=vec![];
 loop {
  std::thread::sleep(Duration::from_secs(1));
  let (status,done)={let p=progress.lock().unwrap();(p.status.clone(),p.done)};
  let rss=String::from_utf8(std::process::Command::new("/bin/ps").args(["-o","rss=","-p",&std::process::id().to_string()]).output()?.stdout)?.trim().parse::<u64>()?;
  peak=peak.max(rss);measurements.push(json!({"seconds":now.elapsed().as_secs(),"rssKiB":rss,"done":done,"status":status}));
  println!("{}",measurements.last().unwrap());
  if now.elapsed().as_secs()>=60&&control.load(Ordering::Relaxed)==0 {control.store(1,Ordering::Relaxed);}
  if status=="已暂停" {assert!(done>start);break;}
  if status.starts_with("失败") {anyhow::bail!("stress failed: {}",progress.lock().unwrap().error);}
  if now.elapsed().as_secs()>120 {anyhow::bail!("pause did not finish");}
 }
 let summary=json!({"peakRssMiB":peak as f64/1024.,"completedDuringTest":measurements.last().unwrap()["done"].as_u64().unwrap()-start as u64,"queueCapacity":7,"workers":7,"paused":true,"samples":measurements});
 std::fs::write("outputs/职业强度模拟器-0.4.9-内存压力验证.json",serde_json::to_vec_pretty(&summary)?)?;
 Ok(())
}
