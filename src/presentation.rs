use super::*;
use egui_extras::{Column, TableBuilder};
use lineup_simulator::workflow::{self, Report, number};
use std::collections::{BTreeMap, BTreeSet};
use workbench::{class_button, human_values, trigger_text, weapon_image, task_status};

fn paper(ui: &mut egui::Ui, body: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(Color32::WHITE)
        .stroke(egui::Stroke::new(1., Color32::from_rgb(230, 234, 240)))
        .corner_radius(18)
        .inner_margin(18.)
        .show(ui, body);
}
fn caption(r: &Report, cat: &Value) -> String {
    format!(
        "{} · T{}",
        zone_name(cat, &r.settings.zone),
        r.settings.tier
    )
}
fn report_date(r: &Report) -> String {
    if let Some(raw) =
        r.id.strip_prefix("search-")
            .and_then(|x| x.split('-').next())
            .and_then(|x| x.parse::<i64>().ok())
            .and_then(chrono::DateTime::from_timestamp_millis)
    {
        return raw
            .with_timezone(&chrono::Local)
            .format("%m-%d %H:%M")
            .to_string();
    }
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(&r.finished) {
        return date
            .with_timezone(&chrono::Local)
            .format("%m-%d %H:%M")
            .to_string();
    }
    r.finished
        .chars()
        .skip(5)
        .take(11)
        .collect::<String>()
        .replace('T', " ")
}
impl App {
    pub(super) fn reports_page(&mut self, ui: &mut egui::Ui) {
        page_title(ui, "历史模拟结果");
        if !self.bench.loaded {
            self.bench.reports = workflow::sync_report_index(&self.store).unwrap_or_default();
            self.bench.rows_clear();
            self.bench.loaded = true;
        }
        let reports = self.bench.reports.clone();
        if !self.bench.job.is_empty() && !reports.iter().any(|r| r.id == self.bench.job) {
            self.bench.job.clear();
        }
        ui.horizontal_top(|ui|{
   ui.vertical(|ui|{
    ui.set_width(236.);
    paper(ui,|ui|{
     ui.horizontal(|ui|{ui.strong(tr("模拟历史"));if ui.small_button(tr("刷新")).clicked(){self.bench.loaded=false;}});
     if ui.selectable_label(self.bench.job.is_empty(),tr("总报告")).clicked(){self.bench.job.clear();self.bench.tab=0;}
     ui.separator();
     egui::ScrollArea::vertical().id_salt("report-history-list").max_height(ui.available_height().max(550.)).show(ui,|ui|{
      for r in &reports{
       let selected=self.bench.job==r.id;
       let fill = if selected { Color32::from_rgb(234, 241, 255) } else { Color32::from_rgb(248, 250, 253) };
       let stroke = if selected { Color32::from_rgb(92, 143, 240) } else { Color32::from_rgb(232, 236, 242) };
       let card = egui::Frame::new().fill(fill).stroke(egui::Stroke::new(1., stroke))
        .corner_radius(12).inner_margin(12.).show(ui, |ui| {
         ui.set_width(ui.available_width());
         ui.strong(tr(caption(r, &self.catalog)));
         ui.label(tr(format!("{} · {}", report_date(r), ["中级","高级","顶级"][r.settings.tier_template])).size(12.).color(Color32::from_rgb(101, 113, 133)));
         task_status(ui, &r.status);
        });
       let response = ui.interact(card.response.rect, ui.make_persistent_id(("history-card", &r.id)), egui::Sense::click()).on_hover_cursor(egui::CursorIcon::PointingHand);
       response.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::SelectableLabel, true, selected, i18n::text(&format!("{} {} {}", caption(r,&self.catalog),report_date(r),r.status))));
       if response.clicked(){self.bench.job=r.id.clone();self.bench.tier=r.settings.tier_template;self.bench.tab=0;self.bench.zone=r.settings.zone.clone();self.bench.difficulty=r.settings.tier;}
       ui.add_space(6.);
      }
      if reports.is_empty(){ui.label(tr("暂无历史模拟"));}
     });
    });
   });
   ui.add_space(4.);
   ui.vertical(|ui|{
    ui.set_width(ui.available_width());
    let selected=reports.iter().find(|r|r.id==self.bench.job).cloned();
    if let Some(report)=selected{
     ui.horizontal_wrapped(|ui|{ui.heading(tr(caption(&report,&self.catalog)));ui.label(tr(format!("{} · {}",report_date(&report),["中级","高级","顶级"][report.settings.tier_template])));});
     ui.horizontal_wrapped(|ui|{ui.selectable_value(&mut self.bench.tab,0,tr("总报告"));for class in 0..9{if class_button(ui,&self.res,&self.templates,class,report.settings.tier_template,self.bench.tab==class+1).clicked(){self.bench.tab=class+1;}}});
     if !report.complete(){task_status(ui, &report.status);return;}
     if self.bench.tab==0{self.eph_chart(ui,&report.settings.zone,&[report.clone()]);}else{
      ui.horizontal(|ui|{ui.selectable_value(&mut self.bench.dps,false,tr("EPH 排名"));ui.selectable_value(&mut self.bench.dps,true,tr("同职业总 DPS 排名"));});
      let class=self.bench.tab-1;let rows=self.report_rows(&report.id);let top=workflow::top(&rows,class,self.bench.dps,10);if top.is_empty(){ui.label(tr("暂无该职业结果"));}let compact=top.into_iter().cloned().collect::<Vec<_>>();self.compact_rank_table(ui,&compact,class,&report.id);
     }
     if ui.button(tr("导出报告")).clicked(){self.export("simulation-report",json!({"schemaVersion":2,"report":report,"runs":report.load(&self.store)}));}
    }else{
     ui.horizontal(|ui|{ui.heading(tr("总报告"));egui::ComboBox::from_id_salt("overview-template").selected_text(tr(["中级","高级","顶级"][self.bench.tier])).show_ui(ui,|ui|{for(i,name)in["中级","高级","顶级"].iter().enumerate(){ui.selectable_value(&mut self.bench.tier,i,tr(*name));}});});
     let mut selected=BTreeMap::new();for r in reports.iter().filter(|r|r.complete()&&r.settings.tier_template==self.bench.tier){selected.entry((r.settings.zone.clone(),r.settings.tier)).or_insert(r.clone());}
     let zones:Vec<_>=self.catalog["zones"].as_array().into_iter().flatten().filter_map(|z|z["hrid"].as_str()).filter(|h|selected.keys().any(|(zone,_)|zone==h)).map(str::to_owned).collect();
     for zone in zones{let rs:Vec<_>=selected.iter().filter(|((h,_),_)|h==&zone).map(|(_,r)|r.clone()).collect();self.eph_chart(ui,&zone,&rs);ui.add_space(12.);}
     if selected.is_empty(){ui.label(tr("暂无已完成报告"));}
     if !selected.is_empty()&&ui.button(tr("导出报告")).clicked(){let payload:Vec<_>=selected.values().map(|r|json!({"report":r,"runs":r.load(&self.store)})).collect();self.export("simulation-report",json!({"schemaVersion":2,"reports":payload}));}
    }
   });
  });
    }
    pub(super) fn result_card(
        &mut self,
        ui: &mut egui::Ui,
        row: &Run,
        index: usize,
        class: usize,
        salt: &str,
    ) {
        self.result_card_open(ui,row,index,class,salt,false);
    }
    pub(super) fn result_card_open(&mut self,ui:&mut egui::Ui,row:&Run,index:usize,class:usize,salt:&str,default_open:bool) {
        let run = self.full_run(row);
        let r = run.as_ref();
        let id = ui.make_persistent_id((salt, &r.id, class, "report-details"));
        let mut open = ui
            .ctx()
            .data_mut(|d| d.get_persisted::<bool>(id).unwrap_or(default_open));
        paper(ui, |ui| {
            ui.horizontal(|ui| {
                ui.strong(format!("#{:02}", index + 1));
                ui.label(tr(format!("队伍 DPS {}", number(r.metrics.dps))));
                ui.label(tr(format!("同职业总 DPS {}", number(search::profession_dps(r, CLASSES[class])))));
                ui.label(tr(format!("人数 {} · 人均 DPS {}", search::profession_count(r, CLASSES[class]), search::profession_average_dps(r, CLASSES[class]).map(number).unwrap_or("—".into()))));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if r.result.is_object() && ui
                        .small_button(tr(if open {
                            "收起详情 ⌃"
                        } else {
                            "展开详情 ⌄"
                        }))
                        .clicked()
                    {
                        open = !open;
                    }
                });
            });
            let height = r.configs.len() as f32 * 34.;
            TableBuilder::new(ui)
                .id_salt((salt, &r.id, "lineup-matrix"))
                .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
                .column(Column::exact(52.))
                .column(Column::remainder().at_least(170.))
                .column(Column::exact(130.))
                .column(Column::exact(125.))
                .header(30., |mut header| {
                    for label in ["职业", "技能 / 光环", "队伍 EPH", "备注"] {
                        header.col(|ui| {
                            ui.strong(tr(label));
                        });
                    }
                })
                .body(|mut body| {
                    body.row(height, |mut row| {
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 8.;
                                for c in &r.configs {
                                    ui.add(weapon_image(
                                        &self.res,
                                        c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or(""),
                                        26.,
                                    ))
                                    .on_hover_text(tr(label(c["name"].as_str().unwrap_or(""))));
                                }
                            });
                        });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.spacing_mut().item_spacing.y = 8.;
                                for c in &r.configs {
                                    ui.allocate_ui_with_layout(
                                        egui::vec2(ui.available_width(), 26.),
                                        egui::Layout::left_to_right(egui::Align::Center),
                                        |ui| {
                                            ui.spacing_mut().item_spacing.x = 7.;
                                            for a in c["abilities"]
                                                .as_array()
                                                .into_iter()
                                                .flatten()
                                                .take(5)
                                            {
                                                let h = a["abilityHrid"]
                                                    .as_str()
                                                    .or_else(|| a["hrid"].as_str())
                                                    .unwrap_or("");
                                                skill_icon(ui, &self.res, &self.catalog, h, 26.);
                                            }
                                        },
                                    );
                                }
                            });
                        });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                ui.add_space((height - 32.) / 2.);
                                ui.label(
                                    egui::RichText::new(number(r.metrics.eph))
                                        .size(25.)
                                        .strong()
                                        .color(Color32::from_rgb(10, 89, 247)),
                                );
                            });
                        });
                        row.col(|ui| {
                            ui.vertical(|ui| {
                                let (d, m) = workflow::notes(r);
                                let count = usize::from(!d.is_empty()) + usize::from(!m.is_empty());
                                let content = if count == 0 {
                                    20.
                                } else {
                                    count as f32 * 30. + (count - 1) as f32 * 10.
                                };
                                ui.add_space(((height - content) / 2.).max(0.));
                                if !d.is_empty() {
                                    outline_tag(ui, "高死亡", Color32::from_rgb(205, 49, 59));
                                }
                                if !m.is_empty() {
                                    outline_tag(ui, "OOM", Color32::from_rgb(10, 89, 247));
                                }
                                if d.is_empty() && m.is_empty() {
                                    ui.label("—");
                                }
                            });
                        });
                    });
                });
            if open {
                ui.add_space(14.);
                ui.separator();
                self.run_report_details(ui, r, class);
            }
        });
        ui.ctx().data_mut(|d| d.insert_persisted(id, open));
    }
    fn run_report_details(&mut self, ui: &mut egui::Ui, r: &Run, class: usize) {
        ui.heading(tr("队伍表现"));
        value_table(
            ui,
            &["指标", "数值"],
            &[
                vec!["队伍 DPS".into(), number(r.metrics.dps)],
                vec![
                    "同职业总 DPS".into(),
                    number(search::profession_dps(r, CLASSES[class])),
                ],
                vec!["人数".into(), search::profession_count(r, CLASSES[class]).to_string()],
                vec!["人均 DPS".into(), search::profession_average_dps(r, CLASSES[class]).map(number).unwrap_or("—".into())],
                vec![
                    "EPH 95% 区间".into(),
                    format!("{} ± {}", number(r.metrics.eph), number(r.ci95)),
                ],
                vec!["成功通关".into(), number(r.metrics.completed)],
                vec!["失败次数".into(), number(r.metrics.failed)],
                vec!["死亡 / 小时".into(), number(r.metrics.deaths)],
                vec!["耗蓝 / 小时".into(), number(r.metrics.mana)],
            ],
        );
        let (deaths, mana) = workflow::notes(r);
        if !deaths.is_empty() || !mana.is_empty() {
            ui.add_space(10.);
            let mut notes = vec![];
            for (i, rate) in deaths {
                notes.push(vec![
                    format!("队员 {}", i + 1),
                    "高死亡".into(),
                    format!("{} /h", number(rate)),
                ]);
            }
            for i in mana {
                notes.push(vec![
                    format!("队员 {}", i + 1),
                    "OOM".into(),
                    "出现过缺蓝".into(),
                ]);
            }
            value_table(ui, &["队员", "备注", "记录"], &notes);
        }
        ui.add_space(16.);
        ui.heading(tr("配装与消耗品"));
        TableBuilder::new(ui)
            .id_salt((&r.id, "gear-matrix"))
            .striped(true)
            .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
            .column(Column::exact(46.))
            .column(Column::remainder().at_least(170.))
            .column(Column::exact(104.))
            .column(Column::exact(104.))
            .column(Column::exact(86.))
            .header(32., |mut header| {
                for h in ["职业", "装备", "食物", "饮料", "DPS"] {
                    header.col(|ui| {
                        ui.strong(tr(h));
                    });
                }
            })
            .body(|mut body| {
                for (i, c) in r.configs.iter().enumerate() {
                    body.row(72., |mut row| {
                        row.col(|ui| {
                            ui.add(weapon_image(
                                &self.res,
                                c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or(""),
                                28.,
                            ));
                        });
                        row.col(|ui| {
                            ui.horizontal_wrapped(|ui| {
                                for (_, item) in c["equipment"].as_object().into_iter().flatten() {
                                    let h = item["itemHrid"].as_str().unwrap_or("");
                                    if h.is_empty() {
                                        continue;
                                    }
                                    let name = r.result["equipmentSnapshot"][h]["name"]
                                        .as_str()
                                        .or_else(|| self.catalog["items"][h]["name"].as_str())
                                        .unwrap_or("装备");
                                    ui.add(weapon_image(&self.res, h, 24.)).on_hover_text(tr(
                                        format!("{} +{}", name, item["enhancementLevel"]),
                                    ));
                                }
                            });
                        });
                        row.col(|ui| {
                            consumable_icons(ui, &self.res, &self.catalog, &c["food"]);
                        });
                        row.col(|ui| {
                            consumable_icons(ui, &self.res, &self.catalog, &c["drinks"]);
                        });
                        row.col(|ui| {
                            ui.label(number(r.metrics.player_dps.get(i).copied().unwrap_or(0.)));
                        });
                    });
                }
            });
        ui.collapsing(tr("完整属性与触发条件"), |ui| {
            for (i, c) in r.configs.iter().enumerate() {
                ui.push_id((&r.id, i), |ui| {
                    ui.horizontal(|ui| {
                        ui.add(weapon_image(
                            &self.res,
                            c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or(""),
                            25.,
                        ));
                        ui.strong(tr(format!("队员 {}", i + 1)));
                    });
                    human_values(ui, &c["levels"]);
                    human_values(
                        ui,
                        &r.result["compiledScenario"]["players"][i]["equipStats"],
                    );
                    for (key, cat, title) in [
                        ("houseRooms", "houseRooms", "房屋"),
                        ("guildBuffs", "guildBuffs", "神龛"),
                    ] {
                        let rows: Vec<_> = c[key]
                            .as_object()
                            .into_iter()
                            .flatten()
                            .filter_map(|(h, v)| {
                                v.as_f64().map(|n| {
                                    vec![
                                        self.catalog[cat][h]["name"]
                                            .as_str()
                                            .unwrap_or(title)
                                            .into(),
                                        number(n),
                                    ]
                                })
                            })
                            .collect();
                        if !rows.is_empty() {
                            value_table(ui, &[title, "等级"], &rows);
                        }
                    }
                    for (h, rows) in c["triggerMap"].as_object().into_iter().flatten() {
                        let name = self.catalog["abilities"][h]["name"]
                            .as_str()
                            .or_else(|| self.catalog["items"][h]["name"].as_str())
                            .unwrap_or("条件");
                        ui.strong(tr(name));
                        for t in rows.as_array().into_iter().flatten() {
                            trigger_text(ui, &self.catalog, t);
                        }
                    }
                    ui.collapsing(tr("装备词条"), |ui| {
                        for (_, item) in c["equipment"].as_object().into_iter().flatten() {
                            let h = item["itemHrid"].as_str().unwrap_or("");
                            let snapshot = &r.result["equipmentSnapshot"][h];
                            if snapshot.is_object() {
                                ui.horizontal(|ui| {
                                    ui.add(weapon_image(&self.res, h, 24.));
                                    ui.strong(tr(snapshot["name"].as_str().unwrap_or("装备")));
                                });
                                let rows: Vec<_> = snapshot["equipmentDetail"]["combatStats"]
                                    .as_object()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(|(k, v)| {
                                        Some(vec![stat_label(k)?.into(), number(v.as_f64()?)])
                                    })
                                    .collect();
                                value_table(ui, &["属性", "数值"], &rows);
                            }
                        }
                    });
                    ui.separator();
                });
            }
        });
        ui.add_space(18.);
        weapon_report_tables(ui, &self.res, &self.catalog, r);
        ui.add_space(16.);
        if ui.button(tr("导出完整结果")).clicked() {
            self.export("result", json!(r));
        }
    }
}
fn outline_tag(ui: &mut egui::Ui, text: &str, color: Color32) {
    egui::Frame::new()
        .fill(color.gamma_multiply(0.035))
        .stroke(egui::Stroke::new(1., color))
        .corner_radius(6)
        .inner_margin(egui::Margin::symmetric(9, 4))
        .show(ui, |ui| {
            ui.label(egui::RichText::new(i18n::text(text)).color(color).strong());
        });
}
fn skill_icon(ui: &mut egui::Ui, res: &std::path::Path, cat: &Value, h: &str, size: f32) {
    let slug = h.rsplit('/').next().unwrap_or(h);
    let path = res.join("icons/abilities").join(format!("{slug}.png"));
    if path.exists() {
        ui.add(
            icons::image(res, h, size),
        )
        .on_hover_text(tr(cat["abilities"][h]["name"].as_str().unwrap_or("技能")));
    }
}
fn consumable_icons(ui: &mut egui::Ui, res: &std::path::Path, cat: &Value, values: &Value) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 5.;
        for h in values
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            ui.add(weapon_image(res, h, 26.))
                .on_hover_text(tr(cat["items"][h]["name"].as_str().unwrap_or("消耗品")));
        }
    });
}
fn value_table(ui: &mut egui::Ui, headers: &[&str], rows: &[Vec<String>]) {
    if rows.is_empty() {
        return;
    }
    let salt = ui.next_auto_id();
    TableBuilder::new(ui)
        .id_salt(salt)
        .striped(true)
        .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
        .columns(Column::remainder(), headers.len())
        .header(30., |mut h| {
            for label in headers {
                h.col(|ui| {
                    ui.strong(tr(*label));
                });
            }
        })
        .body(|mut b| {
            for values in rows {
                b.row(31., |mut row| {
                    for v in values {
                        row.col(|ui| {
                            ui.label(tr(v));
                        });
                    }
                });
            }
        });
}
fn phase_name(cat: &Value, h: &str) -> String {
    if h == "all" {
        "全程".into()
    } else if h == "normal" {
        "普通阶段".into()
    } else {
        cat["monsters"][h]["name"].as_str().unwrap_or("Boss").into()
    }
}
fn weapon_report_tables(ui: &mut egui::Ui, res: &std::path::Path, cat: &Value, run: &Run) {
    let report = if run.result["weaponAnalysis"]["schemaVersion"] == 2 {
        run.result["weaponAnalysis"].clone()
    } else {
        lineup_simulator::analysis::weapon_report(run)
    };
    if report["players"]
        .as_array()
        .is_none_or(|rows| rows.is_empty())
    {
        return;
    }
    ui.heading(tr("武器特效分析"));
    if run.result["weaponObservationVersion"].as_u64().unwrap_or(0) < 2 {
        ui.label(tr("旧版武器统计；新增指标不可用"));
    }
    for player in report["players"].as_array().into_iter().flatten() {
        let slot = player["slot"].as_u64().unwrap_or(0) as usize;
        let weapon = player["weapon"]["itemHrid"].as_str().unwrap_or("");
        ui.add_space(12.);
        ui.horizontal(|ui| {
            ui.add(weapon_image(res, weapon, 32.));
            ui.strong(tr(format!(
                "{} · 队员 {}",
                run.result["equipmentSnapshot"][weapon]["name"]
                    .as_str()
                    .or_else(|| cat["items"][weapon]["name"].as_str())
                    .unwrap_or("武器"),
                slot + 1
            )));
        });
        for effect in player["effects"].as_array().into_iter().flatten() {
            ui.strong(tr(effect["effect"].as_str().unwrap_or("特效")));
            let key = effect["key"].as_str().unwrap_or("");
            let mut stages = vec![("all".to_owned(), effect.clone())];
            let mut phases: Vec<_> = report["phases"].as_object().into_iter().flatten().collect();
            phases.sort_by_key(|(h, _)| if h.as_str() == "normal" { 0 } else { 1 });
            for (h, p) in phases {
                if let Some(e) = p["players"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|r| r["slot"] == slot)
                    .and_then(|r| r["effects"].as_array())
                    .and_then(|a| a.iter().find(|e| e["key"] == key))
                {
                    stages.push((h.clone(), e.clone()));
                }
            }
            if key == "ripple" {
                ripple_table(ui, res, cat, &stages);
            } else {
                let metrics = effect_columns(key);
                let mut headers = vec!["阶段"];
                headers.extend(metrics.iter().map(|(_, h, _)| *h));
                let rows: Vec<_> = stages
                    .iter()
                    .map(|(phase, e)| {
                        let mut row = vec![phase_name(cat, phase)];
                        row.extend(metrics.iter().map(|(k, _, percent)| value(e, k, *percent)));
                        row
                    })
                    .collect();
                value_table(ui, &headers, &rows);
            }
            if let Some(members) = effect["teammates"].as_array() {
                let rows = members
                    .iter()
                    .map(|t| {
                        vec![
                            format!("队员 {}", t["slot"].as_u64().unwrap_or(0) + 1),
                            value(t, "damage", false),
                            value(t, "dps", false),
                            value(t, "share", true),
                        ]
                    })
                    .collect::<Vec<_>>();
                value_table(ui, &["队友", "转入伤害", "转入 DPS", "队友伤害占比"], &rows);
            }
            if let Some(receivers) = effect["receivers"].as_array() {
                let rows = receivers
                    .iter()
                    .map(|t| {
                        vec![
                            format!("队员 {}", t["slot"].as_u64().unwrap_or(0) + 1),
                            value(t, "healing", false),
                        ]
                    })
                    .collect::<Vec<_>>();
                value_table(ui, &["受治疗队员", "有效治疗"], &rows);
            }
            if let Some(targets) = effect["targets"].as_array() {
                let rows = targets
                    .iter()
                    .map(|t| {
                        vec![
                            format!("队员 {}", t["slot"].as_u64().unwrap_or(0) + 1),
                            value(t, "count", false),
                        ]
                    })
                    .collect::<Vec<_>>();
                value_table(ui, &["保护队员", "阻止攻击"], &rows);
            }
            if let Some(layers) = effect["damageByLayer"].as_array() {
                let rows = layers
                    .iter()
                    .enumerate()
                    .map(|(i, v)| vec![i.to_string(), number(v.as_f64().unwrap_or(0.))])
                    .collect::<Vec<_>>();
                value_table(ui, &["层数", "伤害"], &rows);
            }
        }
        ui.separator();
    }
}
fn value(e: &Value, key: &str, percent: bool) -> String {
    e[key]
        .as_f64()
        .map(|n| {
            if percent {
                format!("{}%", number(n * 100.))
            } else if ["triggers", "events", "applications", "count"].contains(&key) {
                format!("{n:.0}")
            } else {
                number(n)
            }
        })
        .unwrap_or("—".into())
}
fn effect_columns(key: &str) -> Vec<(&'static str, &'static str, bool)> {
    match key {
        "curse" => vec![
            ("rawDps", "原始 DPS", false),
            ("attributedDps", "归因后 DPS", false),
            ("damage", "转入伤害", false),
            ("dps", "转入 DPS", false),
            ("teammateShare", "队友占比", true),
            ("hitLayers", "命中均层", false),
            ("fullHitShare", "满层命中率", true),
        ],
        "pierce" => vec![
            ("triggers", "触发", false),
            ("targetsPerTrigger", "平均目标", false),
            ("hitsPerTrigger", "平均命中", false),
            ("damage", "额外伤害", false),
            ("dps", "额外 DPS", false),
            ("personalShare", "个人占比", true),
            ("teamShare", "团队占比", true),
        ],
        "blaze" => vec![
            ("triggers", "触发", false),
            ("damage", "追加伤害", false),
            ("dps", "追加 DPS", false),
            ("personalShare", "个人占比", true),
        ],
        "bloom" => vec![
            ("triggers", "触发", false),
            ("effectiveHealing", "有效治疗", false),
            ("healingPerTrigger", "每次治疗", false),
            ("overhealShare", "溢出比例", true),
            ("healingShare", "治疗占比", true),
        ],
        "parry" => vec![
            ("triggers", "触发", false),
            ("damage", "反击伤害", false),
            ("dps", "反击 DPS", false),
            ("personalShare", "个人占比", true),
            ("preventedDamage", "阻止伤害", false),
            ("preventionShare", "减伤比例", true),
        ],
        "mayhem" => vec![
            ("triggers", "触发", false),
            ("extraHits", "重试命中", false),
            ("damage", "重试伤害", false),
            ("dps", "重试 DPS", false),
            ("personalShare", "个人占比", true),
        ],
        "fury" => vec![
            ("meanLayers", "平均层数", false),
            ("fullUptime", "满层覆盖", true),
            ("hitLayers", "命中均层", false),
            ("dps", "额外 DPS", false),
            ("gainShare", "DPS 提升", true),
        ],
        "weaken" => vec![
            ("applications", "施加次数", false),
            ("meanLayers", "平均层数", false),
            ("fullUptime", "满层覆盖", true),
            ("preventedDamage", "减少承伤", false),
            ("preventionShare", "减伤比例", true),
        ],
        _ => vec![],
    }
}
fn ripple_table(ui: &mut egui::Ui, res: &std::path::Path, cat: &Value, stages: &[(String, Value)]) {
    let skills: BTreeSet<_> = stages
        .iter()
        .flat_map(|(_, e)| e["cooldowns"].as_array().into_iter().flatten())
        .filter_map(|v| v["ability"].as_str().map(str::to_owned))
        .collect();
    let mut rows = vec![];
    for h in skills {
        for (phase, e) in stages {
            if let Some(c) = e["cooldowns"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|c| c["ability"] == h)
            {
                rows.push((
                    h.clone(),
                    phase.clone(),
                    value(c, "meanSeconds", false),
                    value(c, "ratio", true),
                ));
            }
        }
    }
    let table_id = ui.next_auto_id();
    TableBuilder::new(ui)
        .id_salt(table_id)
        .striped(true)
        .column(Column::exact(56.))
        .column(Column::remainder())
        .column(Column::remainder())
        .column(Column::remainder())
        .header(32., |mut h| {
            for title in ["技能", "阶段", "平均缩减（秒）", "原始 CD 占比"] {
                h.col(|ui| {
                    ui.strong(tr(title));
                });
            }
        })
        .body(|mut b| {
            for (h, phase, seconds, ratio) in rows {
                b.row(32., |mut r| {
                    r.col(|ui| {
                        skill_icon(ui, res, cat, &h, 24.);
                    });
                    r.col(|ui| {
                        ui.label(tr(phase_name(cat, &phase)));
                    });
                    r.col(|ui| {
                        ui.label(seconds);
                    });
                    r.col(|ui| {
                        ui.label(ratio);
                    });
                });
            }
        });
}
