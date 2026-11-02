use super::*;
use egui_extras::{Column,TableBuilder};
use lineup_simulator::{overview,workflow::{self,Report,number}};
use workbench::{class_weapon,weapon_image};
const ACCENT:Color32=Color32::from_rgb(255,112,28);
fn difficulty_color(tier:u32)->Color32 {
 [Color32::from_rgb(255,224,205),Color32::from_rgb(255,197,163),Color32::from_rgb(255,169,120),Color32::from_rgb(255,143,80),Color32::from_rgb(255,112,40),Color32::from_rgb(249,88,0)][tier.min(5)as usize]
}
fn badge(ui:&mut egui::Ui,text:&str){
 egui::Frame::new().fill(Color32::from_rgb(210,78,0)).corner_radius(4).inner_margin(egui::Margin::symmetric(6,2)).show(ui,|ui|{ui.label(tr(text).color(Color32::WHITE).size(11.).strong());});
}
impl App {
 pub(super) fn overview_card(&mut self,ui:&mut egui::Ui,zone:&str,reports:&[Report]){
  let mut series=reports.iter().filter(|r|r.complete()).map(|r|(r.clone(),self.report_rows(&r.id))).collect::<Vec<_>>();
  series.sort_by_key(|(r,_)|r.settings.tier);
  let mut dps=*self.bench.overview_dps.get(zone).unwrap_or(&false);
  let mut navigate:Option<(String,usize)>=None;
  egui::Frame::new().fill(Color32::WHITE).stroke(egui::Stroke::new(1.,Color32::from_rgb(233,231,228)))
   .corner_radius(16).inner_margin(20.).show(ui,|ui|{
    ui.horizontal(|ui|{
     game_icon(ui,&self.res,zone_icon(zone),28.);
     ui.heading(tr(zone_name(&self.catalog,zone)));
     ui.with_layout(egui::Layout::right_to_left(egui::Align::Center),|ui|{
      ui.scope(|ui|{ui.visuals_mut().selection.bg_fill=ACCENT;ui.visuals_mut().selection.stroke=egui::Stroke::new(1.,ACCENT);
       ui.selectable_value(&mut dps,true,"DPS");ui.selectable_value(&mut dps,false,"EPH");});
     });
    });
    let metric=if dps{"同职业总 DPS"}else{"EPH"};
    let rows=overview::ranking(&series,dps);
    ui.add_space(8.);
    ui.horizontal_wrapped(|ui|{ui.add_space(((ui.available_width()-series.len()as f32*52.)/2.).max(0.));for(report,_)in &series{ui.label(tr("■").color(difficulty_color(report.settings.tier)));ui.label(tr(format!("T{}",report.settings.tier)).color(Color32::from_rgb(117,121,130)).size(12.));}});
    let max=rows.iter().filter_map(|(_,r)|r.as_ref().map(|r|r.value)).fold(0.,f64::max);
    let(tick,top)=overview::chart_scale(max);
    let w=ui.available_width().max(520.);
    let(rect,_)=ui.allocate_exact_size(egui::vec2(w,200.),egui::Sense::hover());
    let plot=egui::Rect::from_min_max(rect.min+egui::vec2(35.,20.),rect.max-egui::vec2(4.,37.));
    let painter=ui.painter();
    for n in 0..=(top/tick).round()as usize{
     let value=n as f64*tick;let y=plot.bottom()-(value/top)as f32*plot.height();
     painter.line_segment([egui::pos2(plot.left(),y),egui::pos2(plot.right(),y)],egui::Stroke::new(1.,Color32::from_rgb(238,238,238)));
     painter.text(egui::pos2(plot.left()-8.,y),egui::Align2::RIGHT_CENTER,number(value),egui::FontId::proportional(10.),Color32::from_rgb(136,136,140));
    }
    let step=plot.width()/9.;let group=(step-14.).max(10.);let bw=(group/series.len().max(1)as f32).min(13.);
    for(pos,(class,best))in rows.iter().enumerate(){
     let cx=plot.left()+step*(pos as f32+0.5);
     for(j,(report,runs))in series.iter().enumerate(){
      if let Some(run)=workflow::top(runs,*class,dps,1).first(){
       let value=overview::value(run,*class,dps);let x=cx-bw*series.len()as f32/2.+j as f32*bw;
       let height=(value/top)as f32*plot.height();
       let bar=egui::Rect::from_min_max(egui::pos2(x,plot.bottom()-height.max(1.)),egui::pos2(x+bw-2.,plot.bottom()));
       ui.painter().rect_filled(bar,3.,difficulty_color(report.settings.tier));
       let response=ui.interact(bar.expand(3.),ui.id().with((zone,class,j,"overview-bar")),egui::Sense::click());
       let ci=if !dps&&run.seeds.len()>1{format!("\n95% CI ± {}",number(run.ci95))}else{String::new()};
       response.clone().on_hover_text(tr(format!("{} · T{}\n{} {}{}\n{}",NAMES[*class],report.settings.tier,metric,number(value),ci,composition_name(&run.configs))));
       if response.clicked(){navigate=Some((report.id.clone(),*class));}
      }
     }
     if let Some(best)=best{
      let y=plot.bottom()-(best.value/top)as f32*plot.height()-9.;
      ui.painter().text(egui::pos2(cx,y),egui::Align2::CENTER_BOTTOM,number(best.value),egui::FontId::proportional(10.),Color32::from_rgb(52,55,63));
     }
     ui.put(egui::Rect::from_center_size(egui::pos2(cx,plot.bottom()+21.),egui::vec2(24.,24.)),weapon_image(&self.res,&class_weapon(&self.templates,*class,self.bench.tier),24.)).on_hover_text(tr(NAMES[*class]));
    }
    ui.add_space(12.);ui.separator();ui.add_space(10.);
    ui.horizontal(|ui|{
     ui.strong(tr("各职业最佳阵容"));
     ui.with_layout(egui::Layout::right_to_left(egui::Align::Center),|ui|{
      if let Some((c,Some(best)))=rows.first(){if best.value>0.{ui.label(tr(format!("最强：{} · {} {}",NAMES[*c],metric,number(best.value))).color(ACCENT).strong());}}
     });
    });
    ui.scope(|ui|{
     ui.visuals_mut().selection.bg_fill=Color32::from_rgb(255,245,237);ui.visuals_mut().selection.stroke=egui::Stroke::new(1.,Color32::from_rgb(45,49,58));
     let mut table=TableBuilder::new(ui).id_salt((zone,"profession-best",dps)).cell_layout(egui::Layout::left_to_right(egui::Align::Center))
      .column(Column::exact(26.)).column(Column::exact(112.)).column(Column::exact(70.))
      .column(Column::remainder().at_least(150.)).column(Column::exact(if dps{105.}else{65.}));
     if dps{table=table.column(Column::exact(35.)).column(Column::exact(75.));}
     table.column(Column::exact(80.))
      .header(30.,|mut header|{let mut labels=vec!["排名","职业","最佳难度","最佳阵容",metric];if dps{labels.extend(["人数","人均 DPS"]);}labels.push("落后最强");for text in labels{header.col(|ui|{ui.label(tr(text).color(Color32::from_rgb(126,129,137)).size(12.));});}})
      .body(|mut body|{for(index,(class,best))in rows.iter().enumerate(){body.row(32.,|mut row|{
       let strongest=index==0&&best.as_ref().is_some_and(|b|b.value>0.);row.set_selected(strongest);
       row.col(|ui|{ui.label(best.as_ref().map(|_|(index+1).to_string()).unwrap_or("—".into()));});
       row.col(|ui|{ui.add(weapon_image(&self.res,&class_weapon(&self.templates,*class,self.bench.tier),21.)).on_hover_text(tr(NAMES[*class]));ui.label(tr(NAMES[*class]).strong());if strongest{badge(ui,"最强");}});
       row.col(|ui|{ui.label(best.as_ref().map(|r|format!("T{}",r.tier)).unwrap_or("—".into()));});
       row.col(|ui|{if let Some(b)=best{if self.party_shortcut(ui,&b.run.configs){navigate=Some((b.report_id.clone(),*class));}}else{ui.label(tr("暂无结果").color(Color32::GRAY));}});
       row.col(|ui|{let response=ui.label(tr(best.as_ref().map(|b|number(b.value)).unwrap_or("—".into())).strong());if let Some(b)=best{if dps{response.on_hover_text(tr(format!("人数 {} · 人均 DPS {}",search::profession_count(&b.run,CLASSES[*class]),search::profession_average_dps(&b.run,CLASSES[*class]).map(number).unwrap_or("—".into()))));}}});
       if dps{row.col(|ui|{ui.label(best.as_ref().map(|b|search::profession_count(&b.run,CLASSES[*class]).to_string()).unwrap_or("—".into()));});row.col(|ui|{ui.label(best.as_ref().and_then(|b|search::profession_average_dps(&b.run,CLASSES[*class])).map(number).unwrap_or("—".into()));});}
       row.col(|ui|{let gap=best.as_ref().and_then(|b|b.behind);ui.label(tr(gap.map(|v|format!("{}{}%",if v>0.{"↓ "}else{""},number(v))).unwrap_or("—".into())).color(if gap.is_some_and(|v|v>0.){ACCENT}else{Color32::from_rgb(71,77,88)}));});
      });}});
    });
   });
  self.bench.overview_dps.insert(zone.into(),dps);
  if let Some((job,class))=navigate{self.bench.difficulty=reports.iter().find(|r|r.id==job).map(|r|r.settings.tier).unwrap_or(0);self.bench.zone=zone.into();self.bench.job=job;self.bench.tab=class+1;self.bench.dps=dps;}
 }
 fn party_shortcut(&self,ui:&mut egui::Ui,configs:&[Value])->bool{
  let mut clicked=false;ui.spacing_mut().item_spacing.x=4.;ui.spacing_mut().button_padding=egui::vec2(2.,2.);
  for c in configs{
   let fallback=CLASSES.iter().position(|h|c["name"]==*h).map(|class|class_weapon(&self.templates,class,self.bench.tier)).unwrap_or_default();
   let h=c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or(&fallback);
   let response=ui.add(egui::Button::image(weapon_image(&self.res,h,21.)).frame(false));
   clicked|=response.clicked();
   response.on_hover_ui(|ui|{
    ui.strong(tr(label(c["name"].as_str().unwrap_or(""))));
    ui.horizontal(|ui|{for a in c["abilities"].as_array().into_iter().flatten().take(5){let h=a["abilityHrid"].as_str().unwrap_or("");ui.add(icons::image(&self.res,h,24.)).on_hover_text(tr(self.catalog["abilities"][h]["name"].as_str().unwrap_or("技能")));}});
   });
  }clicked
 }
 fn profession_skills(&self,ui:&mut egui::Ui,r:&Run,class:usize){
  let members=r.configs.iter().filter(|c|c["name"]==CLASSES[class]).collect::<Vec<_>>();
  let Some(first)=members.first()else{return;};
  ui.vertical(|ui|{ui.spacing_mut().item_spacing=egui::vec2(2.,2.);ui.spacing_mut().interact_size.y=15.;
   ui.horizontal(|ui|{for a in first["abilities"].as_array().into_iter().flatten().skip(1).take(4){let h=a["abilityHrid"].as_str().unwrap_or("");ui.add(icons::image(&self.res,h,15.)).on_hover_text(tr(self.catalog["abilities"][h]["name"].as_str().unwrap_or("技能")));}});
   ui.horizontal(|ui|{let mut auras:Vec<(String,usize)>=vec![];for member in members{if let Some(h)=member["abilities"][0]["abilityHrid"].as_str(){if let Some((_,n))=auras.iter_mut().find(|(a,_)|a==h){*n+=1;}else{auras.push((h.into(),1));}}}for(h,n)in auras{ui.add(icons::image(&self.res,&h,15.)).on_hover_text(tr(self.catalog["abilities"][&h]["name"].as_str().unwrap_or("光环")));if n>1{ui.label(egui::RichText::new(format!("×{n}")).size(10.));}}});
  });
 }
 pub(super) fn compact_rank_table(&mut self,ui:&mut egui::Ui,rows:&[Run],class:usize,salt:&str){
  let id=ui.make_persistent_id((salt,class,"compact-detail"));
  let mut selected=ui.ctx().data_mut(|d|d.get_temp::<String>(id).unwrap_or_default());
  egui::Frame::new().fill(Color32::WHITE).corner_radius(12).stroke(egui::Stroke::new(1.,Color32::from_rgb(230,234,240))).inner_margin(12.).show(ui,|ui|{
   let show_skills=ui.available_width()>=700.;
   let mut table=TableBuilder::new(ui).id_salt((salt,class,"top-ten-table")).striped(true)
    .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
    .column(Column::exact(25.)).column(Column::remainder().at_least(125.));
   if show_skills {table=table.column(Column::exact(100.));}
   table.column(Column::exact(65.)).column(Column::exact(70.)).column(Column::exact(115.))
    .column(Column::exact(90.)).column(Column::exact(if i18n::english(){60.}else{43.}))
    .header(30.,|mut header|{let mut labels=vec!["排名","阵容"];if show_skills{labels.push("本职业技能");}labels.extend(["EPH","队伍 DPS","同职业总 DPS","备注",""]);for text in labels{header.col(|ui|{ui.label(tr(text).strong().size(12.));});}})
    .body(|mut body|{for(index,r)in rows.iter().take(10).enumerate(){body.row(42.,|mut row|{
     row.col(|ui|{ui.strong(format!("{:02}",index+1));});
     row.col(|ui|{if self.party_shortcut(ui,&r.configs){selected=if selected==r.id{String::new()}else{r.id.clone()};}});
     if show_skills {row.col(|ui|{self.profession_skills(ui,r,class);});}
     row.col(|ui|{ui.label(tr(number(r.metrics.eph)).strong());});
     row.col(|ui|{ui.label(number(r.metrics.dps));});
     row.col(|ui|{ui.vertical(|ui|{ui.spacing_mut().item_spacing.y=1.;ui.label(number(search::profession_dps(r,CLASSES[class])));ui.label(tr(format!("{} 人 · 人均 {}",search::profession_count(r,CLASSES[class]),search::profession_average_dps(r,CLASSES[class]).map(number).unwrap_or("—".into()))).size(10.).color(Color32::from_rgb(95,101,112)));});});
     row.col(|ui|{let(d,m)=workflow::notes(r);ui.spacing_mut().item_spacing.x=4.;
      for(show,text,c)in[(!d.is_empty(),"高死亡",Color32::from_rgb(205,49,59)),(!m.is_empty(),"OOM",Color32::from_rgb(10,89,247))]{if show{egui::Frame::new().stroke(egui::Stroke::new(1.,c)).corner_radius(4).inner_margin(egui::Margin::symmetric(4,2)).show(ui,|ui|{ui.label(tr(text).color(c).size(11.));});}}
      if d.is_empty()&&m.is_empty(){ui.label("—");}
     });
     row.col(|ui|{ui.spacing_mut().button_padding=egui::vec2(4.,3.);if ui.small_button(tr(if selected==r.id{"收起"}else{"详情"})).clicked(){selected=if selected==r.id{String::new()}else{r.id.clone()};}});
    });}});
  });
  ui.ctx().data_mut(|d|d.insert_temp(id,selected.clone()));
  if let Some((index,r))=rows.iter().enumerate().find(|(_,r)|r.id==selected){
   ui.add_space(12.);
   let full=self.full_run(r);
   if full.result.is_object(){self.result_card_open(ui,r,index,class,&format!("{salt}-compact-detail"),true);}
   else{ui.strong(tr(format!("#{:02} · {}",index+1,composition_name(&r.configs))));for c in &r.configs{ui.horizontal(|ui|{ui.add(weapon_image(&self.res,c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or(""),24.));for a in c["abilities"].as_array().into_iter().flatten().take(5){ui.add(icons::image(&self.res,a["abilityHrid"].as_str().unwrap_or(""),24.));}});}}
  }
 }
}
