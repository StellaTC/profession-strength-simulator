use lineup_simulator::{model::*,overview::*,workflow::Report};
use serde_json::{Value,json};
fn run(id:&str,classes:&[&str],eph:f64,dps:&[f64])->Run {
 Run{id:id.into(),configs:classes.iter().map(|c|json!({"name":c})).collect(),settings:Settings::default(),metrics:Metrics{eph,player_dps:dps.to_vec(),..Default::default()},result:Value::Null,versions:json!({}),seeds:vec![],ci95:0.,seed_runs:vec![]}
}
fn series(id:&str,tier:u32,runs:Vec<Run>)->(Report,Vec<Run>){(Report{id:id.into(),settings:Settings{tier,..Default::default()},versions:json!({}),status:"比较完成".into(),finished:String::new(),runs:vec![]},runs)}
#[test]fn best_difficulty_and_party_are_selected_per_profession(){
 let s=vec![series("t0",0,vec![run("a",&["water","sword"],100.,&[20.,30.])]),series("t3",3,vec![run("b",&["water","nature"],150.,&[40.,50.])])];
 let r=ranking(&s,false);assert_eq!(r.len(),9);assert_eq!(r[0].0,0);assert_eq!(r[0].1.as_ref().unwrap().run.id,"b");assert_eq!(r[0].1.as_ref().unwrap().tier,3);
 let sword=r.iter().find(|r|r.0==3).unwrap().1.as_ref().unwrap();assert_eq!(sword.report_id,"t0");assert!((sword.behind.unwrap()-100./3.).abs()<1e-9);
 assert!(r.iter().find(|r|r.0==8).unwrap().1.is_none());
}
#[test]fn dps_sums_duplicate_profession_and_can_pick_different_difficulty(){
 let s=vec![series("a",0,vec![run("a",&["water","water"],90.,&[40.,50.])]),series("b",3,vec![run("b",&["water","sword"],100.,&[60.,70.])])];
 let e=ranking(&s,false);let d=ranking(&s,true);
 assert_eq!(e.iter().find(|r|r.0==0).unwrap().1.as_ref().unwrap().run.id,"b");
 let water=d.iter().find(|r|r.0==0).unwrap().1.as_ref().unwrap();assert_eq!(water.run.id,"a");assert_eq!(water.value,90.);
}
#[test]fn zero_is_a_real_result_but_missing_is_not_zero(){
 let s=vec![series("zero",1,vec![run("z",&["shield"],0.,&[0.])])];let r=ranking(&s,false);
 assert_eq!(r[0].0,8);assert_eq!(r[0].1.as_ref().unwrap().value,0.);assert_eq!(r[0].1.as_ref().unwrap().behind,None);
 assert!(r[1..].iter().all(|r|r.1.is_none()));
}
#[test]fn incomplete_reports_do_not_enter_completed_overview(){
 let mut s=series("running",4,vec![run("x",&["water"],999.,&[1.])]);s.0.status="运行中".into();
 assert!(ranking(&[s],false).iter().all(|r|r.1.is_none()));
}
#[test]fn chart_axis_covers_values_and_preserves_empty_case(){
 for v in [0.,0.01,3.96,330.8,5000.] {let(step,top)=chart_scale(v);assert!(step>0.&&top>0.&&top>=v);assert!(top/step<=10.);}
 assert_eq!(chart_scale(330.8),(50.,350.));
}

#[test]
fn profession_totals_show_headcount_and_mean_without_changing_team_damage() {
 use lineup_simulator::search::{profession_count,profession_dps,profession_average_dps};
 let water=run("water",&["water","water","water"],100.,&[110.,90.,100.]);
 let mixed=run("mixed",&["spear","spear","crossbow"],100.,&[95.,105.,100.]);
 assert_eq!(profession_count(&water,"water"),3);
 assert_eq!(profession_dps(&water,"water"),300.);
 assert_eq!(profession_average_dps(&water,"water"),Some(100.));
 assert_eq!(profession_count(&mixed,"spear"),2);
 assert_eq!(profession_dps(&mixed,"spear"),200.);
 assert_eq!(profession_average_dps(&mixed,"spear"),Some(100.));
 assert_eq!(profession_average_dps(&mixed,"crossbow"),Some(100.));
 assert_eq!(profession_average_dps(&mixed,"water"),None);
 assert_eq!(profession_dps(&water,"water"),profession_dps(&mixed,"spear")+profession_dps(&mixed,"crossbow"));
}
