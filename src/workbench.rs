use super::*;
use lineup_simulator::workflow::{self, Queue, QueueItem, QueueStatus, Report, number};
use std::collections::HashMap;
#[derive(Default)]
pub(super) struct Workbench {
    pub queue: Queue,
    pub equipment_name: String,
    pub reports: Vec<Report>,
    pub tab: usize,
    pub tier: usize,
    pub job: String,
    pub zone: String,
    pub difficulty: u32,
    pub dps: bool,
    pub live_class: usize,
    pub live_dps: bool,
    pub overview_dps: HashMap<String, bool>,
    pub left: String,
    pub right: String,
    rows: HashMap<String, Vec<Run>>,
    full: HashMap<String, Arc<Run>>,
    pub loaded: bool,
}
impl Workbench {
    pub(super) fn rows_clear(&mut self) {
        self.rows.clear();
    }
    pub fn load(db: &Store) -> Self {
        let mut queue: Queue = db
            .get("ui-queue", "active")
            .ok()
            .flatten()
            .unwrap_or_default();
        queue.recover();
        let reports = workflow::sync_report_index(db).unwrap_or_default();
        Self {
            queue,
            reports,
            tier: 1,
            ..Default::default()
        }
    }
}
impl App {
    fn persist_queue(&mut self) {
        if let Err(e) = self.store.put("ui-queue", "active", &self.bench.queue) {
            self.bench.queue.enabled = false;
            self.message = format!("队列保存失败：{e}");
        }
    }
    pub(super) fn queue_tick(&mut self) {
        let running = self
            .bench
            .queue
            .items
            .iter()
            .position(|i| i.status == QueueStatus::Running);
        if let Some(i) = running {
            let p = self.progress.lock().unwrap().clone();
            if p.job == self.bench.queue.items[i].checkpoint.id
                && p.status != "运行中"
                && !p.status.is_empty()
            {
                let item = &mut self.bench.queue.items[i];
                if let Ok(Some(cp)) = self
                    .store
                    .get::<Checkpoint>("checkpoint", &item.checkpoint.id)
                {
                    item.checkpoint = cp;
                }
                item.error = p.error.clone();
                item.status = if p.status.starts_with("比较完成") {
                    QueueStatus::Completed
                } else if p.status == "已暂停" {
                    QueueStatus::Paused
                } else if p.status == "已取消" {
                    QueueStatus::Cancelled
                } else {
                    QueueStatus::Failed
                };
                if item.status != QueueStatus::Completed {
                    self.bench.queue.enabled = false;
                }
                self.bench.reports = workflow::sync_report_index(&self.store).unwrap_or_default();
                self.bench.loaded = false;
                self.persist_queue();
            }
        }
        if self.bench.queue.enabled
            && !self.active()
            && !self
                .bench
                .queue
                .items
                .iter()
                .any(|i| i.status == QueueStatus::Running)
        {
            if let Some(i) = self.bench.queue.next() {
                self.launch_queue(i);
            } else {
                self.bench.queue.enabled = false;
                self.persist_queue();
            }
        }
    }
    fn launch_queue(&mut self, i: usize) {
        if self.active() {
            return;
        }
        let mut item = self.bench.queue.items[i].clone();
        if let Ok(Some(cp)) = self.store.get::<Checkpoint>("checkpoint", &item.checkpoint.id) {
            item.checkpoint = cp;
        }
        if item.checkpoint.versions["engine"] != ENGINE_VERSION {
            let new_id=format!("{}-castfix{}",item.id,chrono::Utc::now().timestamp_micros());
            if let Some(restarted)=workflow::restart_after_cast_fix(&item,new_id) {
                let saved=self.store.put("checkpoint",&restarted.id,&restarted.checkpoint)
                    .and_then(|_|self.store.put("report",&restarted.id,&Report::from_checkpoint(&restarted.checkpoint,&self.store)));
                if let Err(e)=saved {self.message=format!("任务保存失败：{e}");self.bench.queue.enabled=false;return;}
                item=restarted;
                self.bench.queue.items[i]=item.clone();
                self.message="已保留原配置，从头重算以隔离旧引擎结果".into();
            } else {
                self.message = "任务引擎版本已变化，请重新添加任务".into();
                self.bench.queue.enabled = false;
                return;
            }
        }
        if !PathBuf::from(&item.data_file).exists() {
            self.bench.queue.items[i].status = QueueStatus::Failed;
            self.bench.queue.items[i].error = "配置数据快照缺失".into();
            self.bench.queue.enabled = false;
            self.persist_queue();
            return;
        }
        // Use the loaded checkpoint in both UI and worker so its immutable plan
        // table is shared, instead of retaining a second deserialized old copy.
        self.bench.queue.items[i] = item.clone();
        self.bench.queue.items[i].status = QueueStatus::Running;
        self.bench.queue.items[i].error.clear();
        self.persist_queue();
        self.control.store(0, Ordering::Relaxed);
        *self.progress.lock().unwrap() = Progress {
            job: item.checkpoint.id.clone(),
            status: "运行中".into(),
            ..Default::default()
        };
        self.comparison_job = item.checkpoint.id.clone();
        search::start(
            item.checkpoint,
            self.res.clone(),
            item.data_file.into(),
            self.home.clone(),
            self.control.clone(),
            self.progress.clone(),
            item.catalog,
        );
    }
    fn add_queue(&mut self) {
        let action = (|| -> anyhow::Result<QueueItem> {
            let bytes = std::fs::read(&self.data)?;
            let raw: Value = serde_json::from_slice(&bytes)?;
            let dir = self.home.join("queue-snapshots");
            std::fs::create_dir_all(&dir)?;
            let path = dir.join(format!("{}.json", digest(&raw)));
            if !path.exists() {
                std::fs::write(&path, bytes)?;
            }
            let size = self.target_size();
            let mut cp = search::comparison_checkpoint(
                self.settings.clone(),
                &self.templates,
                size,
                self.versions.clone(),
                &self.catalog,
            );
            if cp.finite.as_ref().is_none_or(|s| s.initial == 0) {
                anyhow::bail!("当前职业限制没有合法方案");
            }
            cp.id = format!("{}-q{}", cp.id, chrono::Utc::now().timestamp_micros());
            self.store.put("checkpoint", &cp.id, &cp)?;
            let report = Report::from_checkpoint(&cp, &self.store);
            self.store.put("report", &cp.id, &report)?;
            Ok(QueueItem {
                id: cp.id.clone(),
                checkpoint: cp,
                data_file: path.to_string_lossy().into(),
                catalog: self.catalog.clone(),
                status: QueueStatus::Pending,
                error: String::new(),
            })
        })();
        match action {
            Ok(item) => {
                self.bench.queue.items.push(item);
                self.bench.reports = workflow::sync_report_index(&self.store).unwrap_or_default();
                self.persist_queue();
            }
            Err(e) => self.message = e.to_string(),
        }
    }
    pub(super) fn queue_page(&mut self, ui: &mut egui::Ui) {
        page_title(ui, "全阵容模拟");
        let mut dungeon = self.target_size() == 5;
        ui.horizontal(|ui| {
            if ui
                .selectable_value(&mut dungeon, false, tr("星球"))
                .clicked()
            {
                self.settings.zone = "/actions/combat/sorcerers_tower".into();
            }
            if ui
                .selectable_value(&mut dungeon, true, tr("地牢"))
                .clicked()
            {
                self.settings.zone = "/actions/combat/pirate_cove".into();
            }
        });
        if !dungeon && !workflow::planet_allowed(&self.settings.zone) {
            self.settings.zone = "/actions/combat/sorcerers_tower".into();
        }
        section(ui, "添加模拟", |ui| {
            ui.horizontal_wrapped(|ui| {
                target_selector(
                    ui,
                    &self.catalog,
                    &self.res,
                    &mut self.settings.zone,
                    dungeon,
                    "queue-zone",
                );
                ui.label(tr("难度"));
                egui::ComboBox::from_id_salt("queue-tier")
                    .selected_text(tr(format!("T{}", self.settings.tier)))
                    .show_ui(ui, |ui| {
                        for t in 0..=5 {
                            ui.selectable_value(&mut self.settings.tier, t, tr(format!("T{t}")));
                        }
                    });
                ui.label(tr("模板"));
                egui::ComboBox::from_id_salt("queue-template")
                    .selected_text(tr(["中级", "高级", "顶级"][self.settings.tier_template]))
                    .show_ui(ui, |ui| {
                        for (i, n) in ["中级", "高级", "顶级"].iter().enumerate() {
                            ui.selectable_value(&mut self.settings.tier_template, i, tr(*n));
                        }
                    });
                if ui.button(tr("＋ 添加")).clicked() {
                    self.add_queue();
                }
            });
            ui.collapsing(tr("模拟设置"), |ui| {
                ui.horizontal(|ui| {
                    ui.label(tr("最终种子"));
                    ui.add(egui::DragValue::new(&mut self.settings.comparison_seeds).range(2..=16));
                    ui.label(tr("并行核心"));
                    ui.add(
                        egui::DragValue::new(&mut self.settings.workers).range(
                            1..=std::thread::available_parallelism()
                                .map(|n| n.get())
                                .unwrap_or(1),
                        ),
                    );
                });
                egui::Grid::new("class-limits").show(ui, |ui| {
                    ui.label(tr("职业"));
                    ui.label(tr("最少"));
                    ui.label(tr("最多"));
                    ui.end_row();
                    for i in 0..9 {
                        class_icon(
                            ui,
                            &self.res,
                            &self.templates,
                            i,
                            self.settings.tier_template,
                            30.,
                        );
                        ui.add(
                            egui::DragValue::new(&mut self.settings.minimum[i])
                                .range(0..=if dungeon { 5 } else { 3 }),
                        );
                        ui.add(
                            egui::DragValue::new(&mut self.settings.maximum[i])
                                .range(0..=if dungeon { 5 } else { 3 }),
                        );
                        ui.end_row();
                    }
                });
            });
        });
        ui.horizontal_wrapped(|ui| {
            if ui
                .add_enabled(
                    !self.active() && self.bench.queue.next().is_some(),
                    egui::Button::new(tr("开始队列")),
                )
                .clicked()
            {
                self.bench.queue.enabled = true;
                self.persist_queue();
            }
            if ui
                .add_enabled(self.active(), egui::Button::new(tr("暂停")))
                .clicked()
            {
                self.bench.queue.enabled = false;
                self.control.store(1, Ordering::Relaxed);
                self.persist_queue();
            }
            if ui
                .add_enabled(self.active(), egui::Button::new(tr("取消当前")))
                .clicked()
            {
                self.bench.queue.enabled = false;
                self.control.store(2, Ordering::Relaxed);
                self.persist_queue();
            }
        });
        ui.add_space(14.);
        let has_ranking = self.active() || !self.progress.lock().unwrap().all_rows.is_empty();
        if has_ranking && ui.available_width() >= 970. {
            ui.horizontal_top(|ui| {
                ui.vertical(|ui| { ui.set_width(285.); self.queue_items(ui); });
                ui.add_space(6.);
                ui.vertical(|ui| { ui.set_width(ui.available_width()); self.live_leaderboard(ui); });
            });
        } else {
            self.queue_items(ui);
            self.live_leaderboard(ui);
        }
    }
    fn queue_items(&mut self, ui: &mut egui::Ui) {
        ui.heading(tr("模拟队列"));
        let items: Vec<_> = self
            .bench
            .queue
            .items
            .iter()
            .map(|i| QueueView {
                job: i.checkpoint.id.clone(),
                settings: i.checkpoint.settings.clone(),
                status: i.status.clone(),
                error: i.error.clone(),
            })
            .collect();
        let mut remove = None;
        let mut swap = None;
        let mut launch = None;
        if items.is_empty() {
            ui.label(tr("队列为空"));
        }
        for (i, item) in items.iter().enumerate() {
            egui::Frame::new().fill(Color32::WHITE).stroke(egui::Stroke::new(1., Color32::from_rgb(230,234,240))).corner_radius(14).inner_margin(14.).show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.strong(tr(format!(
                        "{}  {} · T{} · {}",
                        i + 1,
                        zone_name(&self.catalog, &item.settings.zone),
                        item.settings.tier,
                        ["中级", "高级", "顶级"][item.settings.tier_template]
                    )));
                    task_status(ui, item.status.label());
                    if item.status == QueueStatus::Pending {
                        if i > 0
                            && items[i - 1].status == QueueStatus::Pending
                            && ui.small_button(tr("↑")).clicked()
                        {
                            swap = Some((i, i - 1));
                        }
                        if i + 1 < items.len()
                            && items[i + 1].status == QueueStatus::Pending
                            && ui.small_button(tr("↓")).clicked()
                        {
                            swap = Some((i, i + 1));
                        }
                    }
                    if matches!(
                        item.status,
                        QueueStatus::Paused | QueueStatus::Cancelled | QueueStatus::Failed
                    ) && ui
                        .add_enabled(!self.active(), egui::Button::new(tr("继续 / 重试")))
                        .clicked()
                    {
                        launch = Some(i);
                    }
                    if item.status != QueueStatus::Running {
                        if ui.small_button(tr("移除")).clicked() {
                            remove = Some(i);
                        }
                        if item.status == QueueStatus::Failed && ui.button(tr("跳过")).clicked() {
                            self.bench.queue.items[i].status = QueueStatus::Skipped;
                            self.persist_queue();
                        }
                    }
                    if item.status == QueueStatus::Completed && ui.button(tr("报告")).clicked() {
                        self.bench.job = item.job.clone();
                        self.bench.tab = 1;
                        self.page = 4;
                    }
                });
                if !item.error.is_empty() {
                    ui.colored_label(
                        Color32::LIGHT_RED,
                        tr(item.error.lines().next().unwrap_or("失败")),
                    );
                }
                if item.status == QueueStatus::Running {
                    let p = self.progress.lock().unwrap().clone();
                    ui.label(tr(format!("{} · {} / {}", p.stage, p.done, p.total)));
                    ui.scope(|ui| {
                        ui.visuals_mut().extreme_bg_color = Color32::from_rgb(229, 235, 245);
                        ui.add(egui::ProgressBar::new(p.done as f32 / p.total.max(1) as f32)
                            .desired_width(ui.available_width()).desired_height(8.)
                            .corner_radius(4).fill(Color32::from_rgb(10, 89, 247)));
                    });
                }
            });
        }
        if let Some(i) = remove {
            self.bench.queue.items.remove(i);
            self.persist_queue();
        }
        if let Some((a, b)) = swap {
            self.bench.queue.move_item(a, b);
            self.persist_queue();
        }
        if let Some(i) = launch {
            self.bench.queue.enabled = true;
            self.launch_queue(i);
        }
    }
    fn live_leaderboard(&mut self, ui: &mut egui::Ui) {
        let p = self.progress.lock().unwrap().clone();
        if p.all_rows.is_empty() && !self.active() { return; }
        ui.add_space(16.);
        ui.horizontal(|ui| {
            ui.heading(tr("实时排行榜"));
            task_status(ui, &p.status);
        });
        ui.horizontal_wrapped(|ui| {
            for class in 0..9 {
                if class_button(ui, &self.res, &self.templates, class, self.settings.tier_template, self.bench.live_class == class).clicked() {
                    self.bench.live_class = class;
                }
            }
        });
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.bench.live_dps, false, tr("EPH 排名"));
            ui.selectable_value(&mut self.bench.live_dps, true, tr("同职业总 DPS 排名"));
        });
        let class = self.bench.live_class;
        let rows = workflow::top(&p.all_rows, class, self.bench.live_dps, 10);
        if rows.is_empty() { ui.label(tr("暂无该职业结果")); }
        let rows = rows.into_iter().cloned().collect::<Vec<_>>();
        self.compact_rank_table(ui, &rows, class, "live-leaderboard");
    }
    pub(super) fn report_rows(&mut self, id: &str) -> Vec<Run> {
        if !self.bench.rows.contains_key(id) {
            let mut rows = self
                .store
                .get::<Vec<Run>>("comparison", id)
                .ok()
                .flatten()
                .unwrap_or_default();
            let winners: std::collections::HashSet<String> = (0..9)
                .filter_map(|c| {
                    workflow::top(&rows, c, false, 1)
                        .first()
                        .map(|r| r.id.clone())
                })
                .collect();
            for r in &mut rows {
                if winners.contains(&r.id) && r.ci95 == 0. && r.seeds.is_empty() {
                    if let Ok(Some(full)) = self.store.get::<Run>("run", &r.id) {
                        r.ci95 = full.ci95;
                        r.seeds = full.seeds;
                    }
                }
            }
            self.bench.rows.insert(id.into(), rows);
        }
        self.bench.rows[id].clone()
    }
    pub(super) fn full_run(&mut self, r: &Run) -> Arc<Run> {
        if r.result.is_object() {
            return Arc::new(r.clone());
        }
        if !self.bench.full.contains_key(&r.id) {
            let f = self
                .store
                .get::<Run>("run", &r.id)
                .ok()
                .flatten()
                .unwrap_or_else(|| r.clone());
            if self.bench.full.len() > 24 {
                self.bench.full.clear();
            }
            self.bench.full.insert(r.id.clone(), Arc::new(f));
        }
        self.bench.full[&r.id].clone()
    }

    fn report_label(&self, id: &str) -> String {
        self.bench
            .reports
            .iter()
            .find(|r| r.id == id)
            .map(|r| {
                format!(
                    "{} · T{} · {}",
                    zone_name(&self.catalog, &r.settings.zone),
                    r.settings.tier,
                    r.id
                )
            })
            .unwrap_or_else(|| "选择历史任务".into())
    }
    pub(super) fn eph_chart(&mut self, ui: &mut egui::Ui, zone: &str, reports: &[Report]) {
        self.overview_card(ui, zone, reports);
    }

    pub(super) fn compare_page(&mut self, ui: &mut egui::Ui) {
        page_title(ui, "结果对比");
        let reports: Vec<_> = self
            .bench
            .reports
            .iter()
            .filter(|r| r.complete())
            .cloned()
            .collect();
        if reports.is_empty() {
            ui.label(tr("暂无已完成的全量模拟"));
            return;
        }
        if !reports.iter().any(|r| r.id == self.bench.left) {
            self.bench.left = reports[0].id.clone();
        }
        egui::ComboBox::from_id_salt("compare-a")
            .width(700.)
            .selected_text(tr(format!("A　{}", self.report_label(&self.bench.left))))
            .show_ui(ui, |ui| {
                for r in &reports {
                    let text = self.report_label(&r.id);
                    ui.selectable_value(&mut self.bench.left, r.id.clone(), tr(text));
                }
            });
        let left = reports
            .iter()
            .find(|r| r.id == self.bench.left)
            .unwrap()
            .clone();
        let right_choices: Vec<_> = reports
            .iter()
            .filter(|r| {
                r.settings.zone == left.settings.zone && r.settings.tier == left.settings.tier
            })
            .collect();
        if !right_choices.iter().any(|r| r.id == self.bench.right) {
            self.bench.right = right_choices
                .iter()
                .find(|r| r.id != left.id)
                .or(right_choices.first())
                .unwrap()
                .id
                .clone();
        }
        egui::ComboBox::from_id_salt("compare-b")
            .width(700.)
            .selected_text(tr(format!("B　{}", self.report_label(&self.bench.right))))
            .show_ui(ui, |ui| {
                for r in &right_choices {
                    let text = self.report_label(&r.id);
                    ui.selectable_value(&mut self.bench.right, r.id.clone(), tr(text));
                }
            });
        let right = (*right_choices
            .iter()
            .find(|r| r.id == self.bench.right)
            .unwrap())
        .clone();
        for (tag, r) in [("A", &left), ("B", &right)] {
            ui.label(tr(format!(
                "{tag}　{}　引擎 {}　数据 {}　模板 {}　装备 {}",
                ["中级", "高级", "顶级"][r.settings.tier_template],
                r.versions["engine"].as_str().unwrap_or("旧版"),
                r.versions["dataVersion"].as_str().unwrap_or("旧版"),
                r.versions["templatesHash"]
                    .as_str()
                    .unwrap_or("—")
                    .chars()
                    .take(8)
                    .collect::<String>(),
                r.versions["dataHash"]
                    .as_str()
                    .unwrap_or("—")
                    .chars()
                    .take(8)
                    .collect::<String>()
            )));
        }
        let a = self.report_rows(&left.id);
        let b = self.report_rows(&right.id);
        for c in 0..9 {
            class_icon(
                ui,
                &self.res,
                &self.templates,
                c,
                left.settings.tier_template,
                34.,
            );
            let aa = workflow::top(&a, c, false, 10);
            let bb = workflow::top(&b, c, false, 10);
            egui::CollapsingHeader::new(tr("EPH / DPS"))
                .id_salt(("compare-class", c))
                .default_open(true)
                .show(ui, |ui| {
                    if let (Some(x), Some(y)) = (aa.first(), bb.first()) {
                        egui::Grid::new(("delta", c)).striped(true).show(ui, |ui| {
                            for text in ["指标", "A", "B", "差值", "变化"] {
                                ui.strong(tr(text));
                            }
                            ui.end_row();
                            for (name, x, y) in [
                                ("最佳 EPH", x.metrics.eph, y.metrics.eph),
                                (
                                    "同职业总 DPS",
                                    search::profession_dps(x, CLASSES[c]),
                                    search::profession_dps(y, CLASSES[c]),
                                ),
                                ("人数", search::profession_count(x, CLASSES[c]) as f64, search::profession_count(y, CLASSES[c]) as f64),
                                ("人均 DPS", search::profession_average_dps(x, CLASSES[c]).unwrap_or(0.), search::profession_average_dps(y, CLASSES[c]).unwrap_or(0.)),
                            ] {
                                ui.label(tr(name));
                                ui.label(tr(number(x)));
                                ui.label(tr(number(y)));
                                ui.label(tr(number(y - x)));
                                ui.label(tr(workflow::change(x, y)
                                    .map(|v| format!("{}%", number(v)))
                                    .unwrap_or("—".into())));
                                ui.end_row();
                            }
                        });
                    } else {
                        ui.label(tr("缺少该职业结果"));
                    }
                    ui.collapsing(tr("双方前十阵容"), |ui| {
                        for (tag, rows, id) in
                            [("A", aa, left.id.as_str()), ("B", bb, right.id.as_str())]
                        {
                            ui.heading(tr(tag));
                            for (i, r) in rows.iter().enumerate() {
                                self.result_card(ui, r, i, c, id);
                            }
                        }
                    });
                });
        }
    }
}
fn color(i: usize) -> Color32 {
    [
        Color32::from_rgb(82, 163, 255),
        Color32::from_rgb(72, 204, 175),
        Color32::from_rgb(245, 190, 82),
        Color32::from_rgb(181, 139, 246),
        Color32::from_rgb(245, 121, 137),
        Color32::from_rgb(95, 205, 224),
    ][i % 6]
}
pub(super) fn human_values(ui: &mut egui::Ui, v: &Value) {
    ui.horizontal_wrapped(|ui| {
        for (k, v) in v.as_object().into_iter().flatten() {
            if let Some(n) = v.as_f64() {
                if let Some(label) = stat_label(k).or_else(|| match k.as_str() {
                    "stamina" => Some("耐力"),
                    "intelligence" => Some("智力"),
                    "attack" => Some("攻击"),
                    "defense" => Some("防御"),
                    "melee" => Some("近战"),
                    "ranged" => Some("远程"),
                    "magic" => Some("魔法"),
                    _ => None,
                }) {
                    ui.label(tr(format!("{} {}", label, number(n))));
                }
            }
        }
    });
}
pub(super) fn trigger_text(ui: &mut egui::Ui, cat: &Value, t: &Value) {
    let get = |key: &str| t[key].as_str().unwrap_or("");
    let dependency = get("dependencyHrid");
    let condition = get("conditionHrid");
    let comparator = get("comparatorHrid");
    let translated = |h: &str| {
        let tail = h.rsplit('/').next().unwrap_or("");
        match tail {
            "self" => "自身",
            "targeted_enemy" => "目标敌人",
            "all_allies" => "全队",
            "all_enemies" => "全体敌人",
            "current_hitpoints" => "当前生命",
            "missing_hitpoints" => "缺失生命",
            "current_manapoints" => "当前法力",
            "missing_manapoints" => "缺失法力",
            "hitpoint_percentage" => "生命百分比",
            "manapoint_percentage" => "法力百分比",
            "greater_than_equal" => "≥",
            "less_than_equal" => "≤",
            _ => cat["names"][h].as_str().unwrap_or("条件"),
        }
        .to_owned()
    };
    ui.label(tr(format!(
        "{} {} {} {}",
        translated(dependency),
        translated(condition),
        translated(comparator),
        number(t["value"].as_f64().unwrap_or(0.))
    )));
}

impl App {
    pub(super) fn extra_config_editor(&mut self, ui: &mut egui::Ui, cfg: &mut Value) {
        for (key, title, catalog) in [
            ("houseRooms", "房屋", "houseRooms"),
            ("guildBuffs", "神龛", "guildBuffs"),
            ("achievements", "成就", "achievements"),
        ] {
            ui.collapsing(tr(title), |ui| {
                if let Some(m) = cfg[key].as_object_mut() {
                    for (h, v) in m {
                        ui.horizontal(|ui| {
                            ui.label(tr(self.catalog[catalog][h]["name"]
                                .as_str()
                                .unwrap_or(title)));
                            if let Some(mut n) = v.as_f64() {
                                if ui
                                    .add(
                                        egui::DragValue::new(&mut n)
                                            .range(0..=10000)
                                            .max_decimals(2),
                                    )
                                    .changed()
                                {
                                    *v = json!(n);
                                }
                            }
                        });
                    }
                }
            });
        }
        ui.collapsing(tr("触发条件"),|ui|{if let Some(map)=cfg["triggerMap"].as_object_mut(){for(h,ts)in map{let name=self.catalog["abilities"][h]["name"].as_str().or_else(||self.catalog["items"][h]["name"].as_str()).unwrap_or("技能");ui.collapsing(tr(name),|ui|{let Some(rows)=ts.as_array_mut()else{return;};let mut remove=None;for(i,t)in rows.iter_mut().enumerate(){ui.push_id((h,i),|ui|{ui.horizontal_wrapped(|ui|{for(key,cat)in[("dependencyHrid","triggerDependencies"),("conditionHrid","triggerConditions"),("comparatorHrid","triggerComparators")]{let mut selected=t[key].as_str().unwrap_or("").to_string();egui::ComboBox::from_id_salt(key).selected_text(tr(self.catalog[cat][&selected]["name"].as_str().unwrap_or("条件"))).show_ui(ui,|ui|{for(h,v)in self.catalog[cat].as_object().into_iter().flatten(){ui.selectable_value(&mut selected,h.clone(),tr(v["name"].as_str().unwrap_or("条件")));}});t[key]=json!(selected);}let mut v=t["value"].as_f64().unwrap_or(0.);if ui.add(egui::DragValue::new(&mut v).max_decimals(2)).changed(){t["value"]=json!(v);}if ui.small_button(tr("删除")).clicked(){remove=Some(i);}});});}if let Some(i)=remove{rows.remove(i);}if ui.button(tr("新增条件")).clicked(){rows.push(json!({"dependencyHrid":"/combat_trigger_dependencies/self","conditionHrid":"/combat_trigger_conditions/current_hitpoints","comparatorHrid":"/combat_trigger_comparators/less_than_equal","value":50}));}});}}});
    }
}

struct QueueView {
    job: String,
    settings: Settings,
    status: QueueStatus,
    error: String,
}

pub(super) fn class_weapon(ts: &[Template], class: usize, tier: usize) -> String {
    ts.iter()
        .find(|t| t.profession == CLASSES[class] && t.tier == tier)
        .and_then(|t| t.config["equipment"]["weapon"]["itemHrid"].as_str())
        .unwrap_or("/items/cursed_bow_refined")
        .into()
}
pub(super) fn weapon_image(res: &std::path::Path, h: &str, size: f32) -> egui::Image<'static> {
    icons::image(res, h, size).bg_fill(icons::SKILL_BACKPLATE).corner_radius(5.)
}

pub(super) fn class_icon(
    ui: &mut egui::Ui,
    res: &std::path::Path,
    ts: &[Template],
    class: usize,
    tier: usize,
    size: f32,
) {
    ui.add(weapon_image(res, &class_weapon(ts, class, tier), size))
        .on_hover_text(tr(NAMES[class]));
}
pub(super) fn class_button(
    ui: &mut egui::Ui,
    res: &std::path::Path,
    ts: &[Template],
    class: usize,
    tier: usize,
    selected: bool,
) -> egui::Response {
    let response = ui.add(
        egui::Button::image(weapon_image(res, &class_weapon(ts, class, tier), 30.))
            .selected(selected),
    );
    response.widget_info(|| {
        egui::WidgetInfo::selected(
            egui::WidgetType::SelectableLabel,
            true,
            selected,
            i18n::text(NAMES[class]),
        )
    });
    response.on_hover_text(tr(NAMES[class]))
}
/// Color belongs to the task card, never to a separate floating status row.
pub(super) fn task_status(ui: &mut egui::Ui, status: &str) {
    let (text, color) = if status.starts_with("比较完成") || status == "已完成" {
        ("已完成", Color32::from_rgb(25, 128, 92))
    } else if status == "运行中" {
        ("进行中", Color32::from_rgb(10, 89, 247))
    } else if status.starts_with("失败") {
        ("失败", Color32::from_rgb(195, 50, 64))
    } else if status == "已暂停" {
        ("已暂停", Color32::from_rgb(154, 103, 12))
    } else if status == "已取消" || status == "已跳过" {
        (status, Color32::from_rgb(107, 117, 133))
    } else {
        ("待运行", Color32::from_rgb(107, 117, 133))
    };
    egui::Frame::new().fill(color.gamma_multiply(0.10)).corner_radius(6)
        .inner_margin(egui::Margin::symmetric(8, 3)).show(ui, |ui| {
            ui.label(tr(text).color(color).size(12.).strong());
        });
}
