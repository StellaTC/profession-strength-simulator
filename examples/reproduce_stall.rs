//! Replays saved finite checkpoint candidates without opening or modifying the user's database.
use lineup_simulator::{search::Checkpoint,runtime::*,food};
use serde_json::{Value,json};
use std::sync::{Arc,atomic::AtomicU8};
fn main()->anyhow::Result<()> {
 let args:Vec<_>=std::env::args().collect();
 let cp:Checkpoint=serde_json::from_slice(&std::fs::read(&args[1])?)?;
 let state=cp.finite.as_ref().unwrap();let res=resource_dir();
 let data=std::path::PathBuf::from(args.get(2).cloned().unwrap_or(res.join("game-data.json").to_string_lossy().into_owned()));
 let mut runtime=Runtime::new(&res,&data,cp.versions.clone())?;
 let cat=runtime.adapter.request(json!({"op":"catalog"}))?;
 let control=Arc::new(AtomicU8::new(0));
 let start=args.get(3).and_then(|s|s.parse::<usize>().ok()).unwrap_or(state.cursor);
 let end=args.get(4).and_then(|s|s.parse::<usize>().ok()).unwrap_or(start+14);
 for candidate in start..end {
  let mut ordinal=candidate;let mut pi=0;
  while ordinal>=state.plans[pi].count{ordinal-=state.plans[pi].count;pi+=1;}
  let configs=state.plans[pi].configs(ordinal,&cat);let mut settings=cp.settings.clone();settings.hours=state.durations[0];
  println!("candidate {candidate} plan {pi} ordinal {ordinal}: {}",configs.iter().map(|v|v["name"].as_str().unwrap_or("")).collect::<Vec<_>>().join("/"));
  let coffee=lineup_simulator::coffee::screen_with(configs.clone(), &cat, |cfg| {
   let result=runtime.run(cfg.clone(),&settings,&control,false);
   if result.is_err(){
    let sc=runtime.adapter.request(json!({"configs":cfg,"zone":settings.zone,"tier":settings.tier,"hours":settings.hours,"seed":settings.seed}))?;
    std::fs::write(format!("work/stall-20261030/exact-scenario-{candidate}.json"),serde_json::to_vec(&sc)?)?;
   }
   result
  });
  let outcome=coffee.and_then(|best|food::retry_with(best,&cat,|cfg|runtime.run(cfg,&settings,&control,false)));
  match outcome {
   Ok(run)=>println!("OK EPH {}",run.metrics.eph),
   Err(e)=>{let payload=json!({"configs":configs,"settings":settings,"error":e.to_string(),"candidate":candidate});
    std::fs::write(format!("work/stall-20261030/failing-{candidate}.json"),serde_json::to_vec_pretty(&payload)?)?;
    let sc:Value=runtime.adapter.request(json!({"configs":payload["configs"],"zone":settings.zone,"tier":settings.tier,"hours":settings.hours,"seed":settings.seed}))?;
    std::fs::write(format!("work/stall-20261030/scenario-{candidate}.json"),serde_json::to_vec(&sc)?)?;
    println!("ERROR {e}");return Err(e);
   }
  }
 }
 Ok(())
}
