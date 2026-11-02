//! Location-wide profession rankings, over only the supplied completed history runs.
use crate::{model::*,workflow::{self,Report}};
#[derive(Clone)]
pub struct Best {
 pub class:usize, pub report_id:String, pub tier:u32, pub run:Run, pub value:f64, pub behind:Option<f64>,
}
pub fn value(run:&Run,class:usize,dps:bool)->f64 {
 if dps {crate::search::profession_dps(run,CLASSES[class])} else {run.metrics.eph}
}
pub fn ranking(series:&[(Report,Vec<Run>)],dps:bool)->Vec<(usize,Option<Best>)> {
 let mut rows=vec![];
 for class in 0..9 {
  let mut choices=series.iter().filter(|(r,_)|r.complete()).filter_map(|(report,runs)|{
   workflow::top(runs,class,dps,1).first().map(|r|Best{class,report_id:report.id.clone(),tier:report.settings.tier,run:(*r).clone(),value:value(r,class,dps),behind:None})
  }).collect::<Vec<_>>();
  choices.sort_by(|a,b|b.value.total_cmp(&a.value).then(rank(&a.run,&b.run)).then(a.tier.cmp(&b.tier)).then(a.report_id.cmp(&b.report_id)));
  rows.push((class,choices.into_iter().next()));
 }
 rows.sort_by(|(a,x),(b,y)|match(x,y){(Some(x),Some(y))=>y.value.total_cmp(&x.value).then(a.cmp(b)),(Some(_),None)=>std::cmp::Ordering::Less,(None,Some(_))=>std::cmp::Ordering::Greater,(None,None)=>a.cmp(b)});
 let strongest=rows.first().and_then(|(_,b)|b.as_ref()).map(|b|b.value).unwrap_or(0.);
 for(_,b)in &mut rows {if let Some(b)=b{b.behind=if strongest>0.{Some(((strongest-b.value)/strongest*100.).max(0.))}else{None};}}
 rows
}
pub fn chart_scale(max:f64)->(f64,f64) {
 if !max.is_finite()||max<=0.{return(0.2,1.);}
 let raw=max/7.;let power=10f64.powf(raw.log10().floor());
 let unit=[1.,2.,5.,10.].into_iter().find(|n|n*power>=raw).unwrap_or(10.);
 let step=unit*power;(step,(max/step).ceil()*step)
}
