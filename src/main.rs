mod i18n;
mod icons;
mod presentation;
mod report_overview;
use i18n::tr;
mod workbench;
use eframe::egui::{self, Color32, RichText};
use lineup_simulator::{
    model::*,
    runtime::*,
    search::{self, Checkpoint, Progress},
    store::Store,
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, Ordering},
    },
};
struct App {
    bench: workbench::Workbench,
    res: PathBuf,
    home: PathBuf,
    data: PathBuf,
    templates: Vec<Template>,
    builtin: Vec<Template>,
    catalog: Value,
    versions: Value,
    store: Store,
    page: usize,
    selected: usize,
    edit: String,
    template_edit: String,
    settings: Settings,
    party: Vec<Value>,
    locks: Vec<bool>,
    result: Option<Run>,
    progress: Arc<Mutex<Progress>>,
    control: Arc<AtomicU8>,
    message: String,
    party_name: String,
    library: bool,
    item_filter: String,
    item_id: String,
    item_edit: Value,
    member_index: usize,
    item_text: String,
    item_raw: bool,
    editing_template: bool,
    comparison_rows: Vec<Run>,
    config_tab: usize,
    party_reserve: Vec<Value>,
    comparison_job: String,
}
impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let res = resource_dir();
        let home = user_dir();
        std::fs::create_dir_all(&home).unwrap();
        let store = Store::open(&home.join("simulator.sqlite")).unwrap();
        let mut fonts = egui::FontDefinitions::default();
        fonts.font_data.insert(
            "cn".into(),
            Arc::new(egui::FontData::from_owned(
                std::fs::read(res.join("font.ttf")).unwrap(),
            )),
        );
        fonts
            .families
            .get_mut(&egui::FontFamily::Proportional)
            .unwrap()
            .insert(0, "cn".into());
        fonts
            .families
            .get_mut(&egui::FontFamily::Monospace)
            .unwrap()
            .push("cn".into());
        cc.egui_ctx.set_fonts(fonts);
        cc.egui_ctx.set_theme(egui::Theme::Light);
        let mut style = (*cc.egui_ctx.style_of(egui::Theme::Light)).clone();
        style.spacing.item_spacing = egui::vec2(12., 10.);
        style.spacing.button_padding = egui::vec2(14., 9.);
        style.spacing.interact_size.y = 34.;
        style
            .text_styles
            .insert(egui::TextStyle::Heading, egui::FontId::proportional(24.));
        style
            .text_styles
            .insert(egui::TextStyle::Body, egui::FontId::proportional(14.));
        let mut visuals = egui::Visuals::light();
        visuals.override_text_color = Some(Color32::from_rgb(30, 36, 48));
        visuals.panel_fill = Color32::from_rgb(242, 244, 247);
        visuals.window_fill = Color32::WHITE;
        visuals.extreme_bg_color = Color32::WHITE;
        visuals.faint_bg_color = Color32::from_rgb(247, 249, 252);
        visuals.selection.bg_fill = Color32::from_rgb(228, 238, 255);
        visuals.selection.stroke = egui::Stroke::new(1., Color32::from_rgb(10, 89, 247));
        for v in [
            &mut visuals.widgets.inactive,
            &mut visuals.widgets.hovered,
            &mut visuals.widgets.active,
            &mut visuals.widgets.noninteractive,
        ] {
            v.corner_radius = egui::CornerRadius::same(12);
            v.bg_stroke = egui::Stroke::new(1., Color32::from_rgb(230, 234, 240));
            v.fg_stroke.color = Color32::from_rgb(30, 36, 48);
        }
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(248, 250, 253);
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(235, 241, 252);
        visuals.widgets.active.bg_fill = Color32::from_rgb(224, 235, 254);
        visuals.widgets.noninteractive.bg_fill = Color32::WHITE;
        style.visuals = visuals;
        cc.egui_ctx.set_style_of(egui::Theme::Light, style);
        let builtin: Vec<Template> =
            serde_json::from_slice(&std::fs::read(res.join("templates.json")).unwrap()).unwrap();
        let mut templates = store
            .list::<Vec<Template>>("templates")
            .ok()
            .and_then(|v| v.first().cloned())
            .unwrap_or(builtin.clone());
        for t in &mut templates {
            remove_task_badges(&mut t.config);
            if t.version < 4 {
                if let Some(new) = builtin.iter().find(|n| n.id == t.id) {
                    t.config["levels"] = new.config["levels"].clone();
                    t.version = 4;
                }
            }
        }
        for t in &mut templates {
            if t.version < 5 {
                if let Some(new) = builtin.iter().find(|n| n.id == t.id) {
                    t.config["drinks"] = new.config["drinks"].clone();
                    t.version = 5;
                }
            }
        }
        let spear_migration = "spear-presets-attack165-melee160-20261030";
        if !store.get::<bool>("migration", spear_migration).ok().flatten().unwrap_or(false) {
            for t in &mut templates {
                if t.profession == "spear" && t.tier < 3 && builtin.iter().any(|b| b.id == t.id && b.profession == "spear") {
                    t.config["levels"]["attack"] = json!(145 + 10 * t.tier);
                    t.config["levels"]["melee"] = json!(140 + 10 * t.tier);
                    t.version += 1;
                }
            }
            store.put("templates", "active", &templates).expect("保存枪模板等级失败");
            store.put("migration", spear_migration, &true).expect("保存枪模板升级记录失败");
        }
        let house_migration = "top-preset-houses-8-20261030";
        if !store.get::<bool>("migration", house_migration).ok().flatten().unwrap_or(false) {
            for t in &mut templates {
                if t.tier == 2 && builtin.iter().any(|b| b.id == t.id && b.tier == 2) {
                    if let Some(rooms) = t.config["houseRooms"].as_object_mut() {
                        if rooms.values().any(|v| v != &json!(8)) {
                            for v in rooms.values_mut() { *v = json!(8); }
                            t.version += 1;
                        }
                    }
                }
            }
            store.put("templates", "active", &templates).expect("保存顶级房屋预设失败");
            store.put("migration", house_migration, &true).expect("保存房屋预设升级记录失败");
        }
        let shrine_migration = "all-preset-shrines-5-20261029";
        if !store
            .get::<bool>("migration", shrine_migration)
            .ok()
            .flatten()
            .unwrap_or(false)
        {
            set_preset_shrines(&mut templates, &builtin[0].config["guildBuffs"]);
            store
                .put("templates", "active", &templates)
                .expect("保存神龛预设升级失败");
            store
                .put("migration", shrine_migration, &true)
                .expect("保存预设升级记录失败");
        }
        let data = if home.join("game-data.json").exists() {
            home.join("game-data.json")
        } else {
            res.join("game-data.json")
        };
        let raw: Value = serde_json::from_slice(&std::fs::read(&data).unwrap()).unwrap();
        let versions = versions(&raw, &templates);
        let mut adapter = Adapter::new(&res, &data).unwrap();
        let catalog = adapter.request(json!({"op":"catalog"})).unwrap();
        egui_extras::install_image_loaders(&cc.egui_ctx);
        let settings = Settings::default();
        let party: Vec<Value> = ["shield", "fire", "nature", "bow", "water"]
            .iter()
            .map(|c| {
                templates
                    .iter()
                    .find(|t| t.profession == *c && t.tier == 1)
                    .unwrap()
                    .config
                    .clone()
            })
            .collect();
        let edit = serde_json::to_string_pretty(&templates[1].config).unwrap();
        let comparison_rows = store
            .list_recent::<Vec<Run>>("comparison", 1)
            .unwrap_or_default()
            .into_iter()
            .next()
            .unwrap_or_default();
        let bench = workbench::Workbench::load(&store);
        i18n::register(&catalog);
        for party in store.list::<Value>("party").unwrap_or_default() {
            if let Some(name) = party["name"].as_str() {
                i18n::register_user_name(name);
            }
        }
        i18n::set_english(
            store
                .get::<bool>("preferences", "english")
                .ok()
                .flatten()
                .unwrap_or(false),
        );
        Self {
            bench,
            res,
            home: home.clone(),
            data,
            templates,
            builtin,
            catalog,
            versions,
            store,
            page: 2,
            selected: 1,
            template_edit: edit.clone(),
            edit,
            settings,
            party: party.clone(),
            locks: vec![false; 5],
            result: None,
            progress: Arc::new(Mutex::new(Progress::default())),
            control: Arc::new(AtomicU8::new(0)),
            message: String::new(),
            party_name: "我的阵容".into(),
            library: false,
            item_filter: String::new(),
            item_id: "/items/cursed_bow_refined".into(),
            item_edit: Value::Null,
            member_index: 0,
            item_text: String::new(),
            item_raw: false,
            editing_template: false,
            comparison_rows,
            config_tab: 0,
            party_reserve: party.clone(),
            comparison_job: store_job(&home),
        }
    }
    fn active(&self) -> bool {
        self.progress.lock().unwrap().status == "运行中"
    }
    fn manual(&mut self) {
        if self.active() {
            return;
        }
        self.control.store(0, Ordering::Relaxed);
        if !self.progress.lock().unwrap().all_rows.is_empty() {
            self.comparison_rows = (*self.progress.lock().unwrap().all_rows).clone();
        }
        *self.progress.lock().unwrap() = Progress {
            status: "运行中".into(),
            ..Progress::default()
        };
        let (res, data, home, ver, cfg, s, c, p) = (
            self.res.clone(),
            self.data.clone(),
            self.home.clone(),
            self.versions.clone(),
            self.party.clone(),
            self.settings.clone(),
            self.control.clone(),
            self.progress.clone(),
        );
        std::thread::spawn(move || {
            let result =
                Runtime::new(&res, &data, ver).and_then(|mut rt| rt.run(cfg, &s, &c, true));
            let mut pr = p.lock().unwrap();
            match result {
                Ok(r) => {
                    if let Ok(db) = Store::open(&home.join("simulator.sqlite")) {
                        let _ = db.put("run", &r.id, &r);
                    }
                    pr.leaders = vec![r];
                    pr.status = "手动模拟完成".into();
                }
                Err(e) => {
                    pr.status = "已停止".into();
                    pr.error = e.to_string();
                }
            }
        });
    }
    fn import(&mut self) {
        if let Some(p) = rfd::FileDialog::new()
            .add_filter("JSON", &["json"])
            .pick_file()
        {
            let r = (|| -> anyhow::Result<()> {
                let v: Value = serde_json::from_slice(&std::fs::read(p)?)?;
                let value = v.get("payload").unwrap_or(&v);
                if value["abilityDetailMap"].is_object()
                    || value["maps"]["abilityDetailMap"].is_object()
                {
                    let temp = self.home.join("game-data.pending.json");
                    std::fs::write(&temp, serde_json::to_vec(value)?)?;
                    let mut a = Adapter::new(&self.res, &temp)?;
                    let catalog = a.request(json!({"op":"catalog"}))?;
                    a.request(json!({"op":"data"}))?;
                    std::fs::rename(temp, self.home.join("game-data.json"))?;
                    self.data = self.home.join("game-data.json");
                    self.catalog = catalog;
                    self.versions = versions(value, &self.templates);
                } else if value["metrics"].is_object() {
                    let r: Run = serde_json::from_value(value.clone())?;
                    self.store.put("run", &r.id, &r)?;
                    self.result = Some(r);
                    self.page = 3;
                } else if value.is_array() && value[0]["profession"].is_string() {
                    let ts: Vec<Template> = serde_json::from_value(value.clone())?;
                    self.templates = ts;
                    self.store.put("templates", "active", &self.templates)?;
                    self.refresh_versions();
                } else {
                    let mut configs = match import_configs(value) {
                        Ok(c) => c,
                        Err(_) => {
                            let mut a = Adapter::new(&self.res, &self.data)?;
                            a.request(json!({"op":"import","value":value}))?
                                .as_array()
                                .ok_or_else(|| anyhow::anyhow!("无法识别角色格式"))?
                                .clone()
                        }
                    };
                    for c in &mut configs {
                        infer_profession(c, &self.catalog);
                        remove_task_badges(c);
                    }
                    if configs.len() == 1 {
                        let slot = self.member_index.min(self.party.len() - 1);
                        self.party[slot] = configs[0].clone();
                        self.page = 1;
                        return Ok(());
                    }
                    if configs.len() != 3 && configs.len() != 5 {
                        anyhow::bail!("队伍必须为3人或5人")
                    };
                    self.party = configs;
                    self.locks = vec![false; self.party.len()];
                    self.page = 1;
                }
                Ok(())
            })();
            self.message = match r {
                Ok(_) => "导入成功".into(),
                Err(e) => format!("导入失败：{e}"),
            };
        }
    }
    fn refresh_versions(&mut self) {
        let raw: Value = serde_json::from_slice(&std::fs::read(&self.data).unwrap()).unwrap();
        self.versions = versions(&raw, &self.templates);
    }
    fn export(&mut self, kind: &str, value: Value) {
        if let Some(p) = rfd::FileDialog::new()
            .set_file_name(format!("{kind}.json"))
            .save_file()
        {
            let envelope =
                json!({"schemaVersion":1,"kind":kind,"versions":self.versions,"payload":value});
            self.message = match std::fs::write(p, serde_json::to_vec_pretty(&envelope).unwrap()) {
                Ok(_) => "已导出".into(),
                Err(e) => e.to_string(),
            };
        }
    }

    fn library_page(&mut self, ui: &mut egui::Ui) {
        ui.heading(tr("可编辑装备库"));
        ui.horizontal(|ui| {
            ui.label(tr("搜索装备名称"));
            ui.text_edit_singleline(&mut self.item_filter);
        });
        let items = self.catalog["items"].as_object().unwrap();
        let filter = self.item_filter.to_lowercase();
        let choices: Vec<(String, String)> = items
            .iter()
            .filter(|(h, v)| {
                v["equipmentDetail"].is_object()
                    && !h.contains("task_badge")
                    && (filter.is_empty()
                        || h.contains(&filter)
                        || v["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&filter))
            })
            .map(|(h, v)| {
                (
                    h.clone(),
                    v["name"].as_str().unwrap_or("未命名装备").to_owned(),
                )
            })
            .collect();
        let previous = self.item_id.clone();
        egui::ComboBox::from_id_salt("equipment-library")
            .width(700.)
            .selected_text(tr(self.catalog["items"][&self.item_id]["name"]
                .as_str()
                .unwrap_or(&self.item_id)))
            .show_ui(ui, |ui| {
                for (h, name) in choices {
                    ui.selectable_value(&mut self.item_id, h, tr(name));
                }
            });
        if self.item_edit.is_null() || previous != self.item_id {
            self.item_edit = self.catalog["items"][&self.item_id].clone();
            self.item_text = serde_json::to_string_pretty(&self.item_edit).unwrap();
        }
        ui.horizontal(|ui| {
            if ui
                .add_enabled(
                    !self.active(),
                    egui::Button::new(tr("保存装备属性，应用到模拟")),
                )
                .clicked()
            {
                let id = self.item_id.clone();
                let item = if self.item_raw {
                    serde_json::from_str(&self.item_text)
                } else {
                    Ok(self.item_edit.clone())
                };
                match item {
                    Ok(v) => {
                        self.item_edit = v.clone();
                        self.save_item(id, v);
                    }
                    Err(e) => self.message = e.to_string(),
                }
            }
            if ui
                .add_enabled(!self.active(), egui::Button::new(tr("另存为新装备")))
                .clicked()
            {
                let id = format!(
                    "{}__custom_{}",
                    self.item_id,
                    chrono::Utc::now().timestamp_millis()
                );
                if self.bench.equipment_name.trim().is_empty() {
                    self.message = "请输入新装备名称".into();
                    return;
                }
                let mut item = self.item_edit.clone();
                item["hrid"] = json!(id);
                if id.contains("__custom_") {
                    item["englishName"] = item["name"].clone();
                    if let Some(name) = item["name"].as_str() {
                        i18n::register_user_name(name);
                    }
                }
                item["name"] = json!(self.bench.equipment_name.trim());
                self.save_item(id.clone(), item.clone());
                self.item_id = id;
                self.item_edit = item;
                self.item_text = serde_json::to_string_pretty(&self.item_edit).unwrap();
            }
            if ui
                .add_enabled(!self.active(), egui::Button::new(tr("恢复此装备内置属性")))
                .clicked()
            {
                let raw: Value = serde_json::from_slice(
                    &std::fs::read(self.res.join("game-data.json")).unwrap(),
                )
                .unwrap();
                let item = raw["itemDetailMap"][&self.item_id].clone();
                if !item.is_null() {
                    self.item_edit = item.clone();
                    self.save_item(self.item_id.clone(), item);
                }
            }
            if ui.button(tr("导出当前游戏属性库")).clicked() {
                let raw: Value =
                    serde_json::from_slice(&std::fs::read(&self.data).unwrap()).unwrap();
                self.export("game-data", raw);
            }
        });
        ui.horizontal(|ui| {
            ui.label(tr("新装备名称"));
            ui.text_edit_singleline(&mut self.bench.equipment_name);
        });
        human_equipment_editor(ui, &mut self.item_edit);
        ui.separator();
    }

    fn save_item(&mut self, id: String, mut item: Value) {
        let result = (|| -> anyhow::Result<()> {
            if !item["equipmentDetail"].is_object() {
                anyhow::bail!("必须保留 equipmentDetail");
            }
            item["hrid"] = json!(id);
            let mut raw: Value = serde_json::from_slice(&std::fs::read(&self.data)?)?;
            let maps = if raw["maps"].is_object() {
                &mut raw["maps"]
            } else {
                &mut raw
            };
            maps["itemDetailMap"][&id] = item;
            raw["lineupRevision"] = json!(chrono::Utc::now().to_rfc3339());
            let temp = self.home.join("game-data.pending.json");
            std::fs::write(&temp, serde_json::to_vec(&raw)?)?;
            let mut a = Adapter::new(&self.res, &temp)?;
            let catalog = a.request(json!({"op":"catalog"}))?;
            std::fs::rename(&temp, self.home.join("game-data.json"))?;
            self.data = self.home.join("game-data.json");
            self.catalog = catalog;
            self.versions = versions(&raw, &self.templates);
            Ok(())
        })();
        self.message = match result {
            Ok(_) => "装备属性已保存；新模拟将使用修改后的数值。".into(),
            Err(e) => format!("保存失败：{e}"),
        };
    }
    fn member_editor(&mut self, ui: &mut egui::Ui) {
        let Ok(mut cfg) = serde_json::from_str::<Value>(&self.edit) else {
            return;
        };
        ui.collapsing(
            tr("装备与强化（直接选择装备库中的装备）"),
            |ui| {
                let slots = [
                    ("weapon", "武器"),
                    ("off_hand", "副手"),
                    ("head", "头部"),
                    ("body", "上衣"),
                    ("legs", "下装"),
                    ("feet", "鞋"),
                    ("hands", "手套"),
                    ("pouch", "消耗品囊"),
                    ("neck", "项链"),
                    ("earrings", "耳环"),
                    ("ring", "戒指"),
                    ("back", "背部"),
                    ("charm", "护符"),
                ];
                for (slot, name) in slots {
                    ui.horizontal(|ui| {
                        ui.label(tr(name));
                        let mut hrid = cfg["equipment"][slot]["itemHrid"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        let old = hrid.clone();
                        egui::ComboBox::from_id_salt(("member-gear", slot))
                            .width(400.)
                            .selected_text(tr(self.catalog["items"][&hrid]["name"]
                                .as_str()
                                .unwrap_or("空")))
                            .show_ui(ui, |ui| {
                                ui.selectable_value(&mut hrid, String::new(), tr("空"));
                                for (h, v) in self.catalog["items"].as_object().unwrap() {
                                    let typ = v["equipmentDetail"]["type"].as_str().unwrap_or("");
                                    let ok = if slot == "weapon" {
                                        typ.ends_with("/main_hand") || typ.ends_with("/two_hand")
                                    } else {
                                        typ == format!("/equipment_types/{slot}")
                                    };
                                    if ok {
                                        ui.selectable_value(
                                            &mut hrid,
                                            h.clone(),
                                            tr(v["name"].as_str().unwrap_or(h)),
                                        );
                                    }
                                }
                            });
                        if hrid != old {
                            cfg["equipment"][slot]["itemHrid"] = json!(hrid);
                        }
                        let mut level = cfg["equipment"][slot]["enhancementLevel"]
                            .as_u64()
                            .unwrap_or(0);
                        ui.label(tr("强化 +"));
                        ui.add(egui::DragValue::new(&mut level).range(0..=30));
                        cfg["equipment"][slot]["enhancementLevel"] = json!(level);
                        if ui.button(tr("编辑此装备属性")).clicked() {
                            self.item_id = hrid;
                            self.item_edit = Value::Null;
                            self.library = true;
                            self.page = 0;
                        }
                    });
                }
            },
        );
        ui.collapsing(tr("技能、光环与消耗品选择"),|ui|{
            for slot in 0..5{ui.horizontal(|ui|{ui.label(tr(if slot==0{"光环 / 特技"}else{"普通技能"}));let mut h=cfg["abilities"][slot]["abilityHrid"].as_str().unwrap_or("").to_owned();egui::ComboBox::from_id_salt(("ability-editor",slot)).width(350.).selected_text(tr(self.catalog["abilities"][&h]["name"].as_str().unwrap_or(&h))).show_ui(ui,|ui|{for(id,v)in self.catalog["abilities"].as_object().unwrap(){if v["isSpecialAbility"].as_bool().unwrap_or(false)==(slot==0){ui.selectable_value(&mut h,id.clone(),tr(v["name"].as_str().unwrap_or(id)));}}});cfg["abilities"][slot]["abilityHrid"]=json!(h);let mut level=cfg["abilities"][slot]["level"].as_u64().unwrap_or(100);ui.label(tr("等级"));ui.add(egui::DragValue::new(&mut level).range(1..=1000));cfg["abilities"][slot]["level"]=json!(level);});}
            for(key,title,cat)in [("food","食物","/item_categories/food"),("drinks","饮料","/item_categories/drink")]{for slot in 0..3{ui.horizontal(|ui|{ui.label(tr(format!("{title} {}",slot+1)));let mut h=cfg[key][slot].as_str().unwrap_or("").to_owned();egui::ComboBox::from_id_salt(("consumable-editor",key,slot)).width(350.).selected_text(tr(self.catalog["items"][&h]["name"].as_str().unwrap_or("空"))).show_ui(ui,|ui|{ui.selectable_value(&mut h,String::new(),tr("空"));for(id,v)in self.catalog["items"].as_object().unwrap(){if v["categoryHrid"]==cat&&v["consumableDetail"]["usableInActionTypeMap"]["/action_types/combat"]==true{ui.selectable_value(&mut h,id.clone(),tr(v["name"].as_str().unwrap_or(id)));}}});cfg[key][slot]=json!(h);});}}
        });
        ui.collapsing(tr("培养等级"), |ui| {
            for (key, title) in [
                ("stamina", "耐力"),
                ("intelligence", "智力"),
                ("attack", "攻击"),
                ("defense", "防御"),
                ("melee", "近战"),
                ("ranged", "远程"),
                ("magic", "魔法"),
            ] {
                ui.horizontal(|ui| {
                    ui.label(tr(title));
                    let mut n = cfg["levels"][key].as_u64().unwrap_or(1);
                    ui.add(egui::DragValue::new(&mut n).range(1..=1000));
                    cfg["levels"][key] = json!(n);
                });
            }
        });
        self.extra_config_editor(ui, &mut cfg);
        if self.page == 0 {
            if self.editing_template {
                self.templates[self.selected].config = cfg.clone();
                self.template_edit = serde_json::to_string_pretty(&cfg).unwrap();
            } else {
                self.party[self.member_index] = cfg.clone();
            }
        }
        self.edit = serde_json::to_string_pretty(&cfg).unwrap();
    }
    fn templates_page(&mut self, ui: &mut egui::Ui) {
        ui.heading(tr("职业模板"));
        ui.horizontal(|ui| {
            for (i, n) in ["中级", "高级", "顶级"].iter().enumerate() {
                if ui
                    .selectable_label(self.selected % 3 == i, tr(*n))
                    .clicked()
                {
                    self.selected = self.selected / 3 * 3 + i;
                    self.template_edit =
                        serde_json::to_string_pretty(&self.templates[self.selected].config)
                            .unwrap();
                }
            }
        });
        ui.horizontal(|ui| {
            for i in 0..9 {
                if workbench::class_button(
                    ui,
                    &self.res,
                    &self.templates,
                    i,
                    self.selected % 3,
                    self.selected / 3 == i,
                )
                .clicked()
                {
                    self.selected = i * 3 + self.selected % 3;
                    self.template_edit =
                        serde_json::to_string_pretty(&self.templates[self.selected].config)
                            .unwrap();
                }
            }
        });
        let t = self.templates[self.selected].clone();
        let weapon = t.config["equipment"]["weapon"]["itemHrid"]
            .as_str()
            .unwrap_or("");
        let primary =
            self.catalog["items"][weapon]["equipmentDetail"]["combatStats"]["primaryTraining"]
                .as_str()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");
        ui.label(tr(format!(
            "主修 {}　武器 +{}　技能 {}　光环 / 特技 {}",
            t.config["levels"][primary],
            t.config["equipment"]["weapon"]["enhancementLevel"],
            t.config["abilities"][1]["level"],
            t.config["abilities"][0]["level"]
        )));
        ui.horizontal(|ui| {
            if ui
                .add_enabled(!self.active(), egui::Button::new(tr("保存编辑")))
                .clicked()
            {
                match serde_json::from_str::<Value>(&self.template_edit) {
                    Ok(v) => {
                        self.templates[self.selected].config = v;
                        self.templates[self.selected].version += 1;
                        let _ = self.store.put("templates", "active", &self.templates);
                        self.refresh_versions();
                        self.message = "模板已保存".into();
                    }
                    Err(e) => self.message = e.to_string(),
                }
            }
            if ui.button(tr("应用到队员 1")).clicked() {
                let v = serde_json::from_str(&self.template_edit);
                if let Ok(v) = v {
                    if !self.party.is_empty() {
                        self.party[0] = v;
                        self.page = 0;
                        self.config_tab = 0;
                    }
                }
            }
            if ui
                .add_enabled(!self.active(), egui::Button::new(tr("恢复内置模板")))
                .clicked()
            {
                self.templates[self.selected] = self.builtin[self.selected].clone();
                self.template_edit =
                    serde_json::to_string_pretty(&self.templates[self.selected].config).unwrap();
                let _ = self.store.put("templates", "active", &self.templates);
                self.refresh_versions();
            }
            if ui.button(tr("导出全部模板")).clicked() {
                self.export("templates", json!(self.templates));
            }
        });
        let cfg: Value = serde_json::from_str(&self.template_edit).unwrap_or(t.config.clone());
        ui.add_space(12.);
        section(ui, "标准装备搭配", |ui| {
            egui::Grid::new("template-gear")
                .striped(true)
                .min_col_width(130.)
                .show(ui, |ui| {
                    ui.strong(tr("槽位"));
                    ui.strong(tr("装备"));
                    ui.strong(tr("强化"));
                    ui.end_row();
                    if let Some(eq) = cfg["equipment"].as_object() {
                        for (slot, item) in eq {
                            let h = item["itemHrid"].as_str().unwrap_or("");
                            if h.is_empty() {
                                continue;
                            }
                            ui.label(tr(slot_label(slot)));
                            ui.label(tr(self.catalog["items"][h]["name"].as_str().unwrap_or(h)));
                            ui.label(tr(format!("+{}", item["enhancementLevel"])));
                            ui.end_row();
                        }
                    }
                });
        });
        if ui.button(tr("编辑此职业模板")).clicked() {
            self.edit = self.template_edit.clone();
            self.editing_template = true;
            self.page = 5;
        }
    }

    fn target_size(&self) -> usize {
        if self.catalog["zones"]
            .as_array()
            .unwrap()
            .iter()
            .find(|z| z["hrid"] == self.settings.zone)
            .is_some_and(|z| z["combatZoneInfo"]["isDungeon"] == true)
        {
            5
        } else {
            3
        }
    }
    fn resize_party(&mut self, size: usize) {
        for (i, c) in self.party.iter().enumerate() {
            if i < self.party_reserve.len() {
                self.party_reserve[i] = c.clone();
            }
        }
        while self.party_reserve.len() < 5 {
            self.party_reserve.push(self.templates[1].config.clone());
        }
        self.party = self.party_reserve[..size].to_vec();
        self.locks.resize(size, false);
    }
    fn configuration(&mut self, ui: &mut egui::Ui) {
        if self.library {
            self.config_tab = 2;
            self.library = false;
        }
        page_title(ui, "配置中心");
        ui.horizontal(|ui| {
            for (i, title) in ["阵容配置", "职业模板", "装备库"].iter().enumerate() {
                ui.selectable_value(&mut self.config_tab, i, tr(*title));
            }
        });
        ui.add_space(12.);
        ui.separator();
        match self.config_tab {
            0 => self.roster(ui),
            1 => self.templates_page(ui),
            _ => self.library_page(ui),
        }
    }
    fn roster(&mut self, ui: &mut egui::Ui) {
        ui.heading(tr("阵容配置"));
        let mut size = self.party.len();
        ui.horizontal(|ui| {
            ui.selectable_value(&mut size, 3, tr("三人普通地图"));
            ui.selectable_value(&mut size, 5, tr("五人地牢"));
        });
        if size != self.party.len() {
            self.resize_party(size);
            self.settings.zone = if size == 5 {
                "/actions/combat/pirate_cove"
            } else {
                "/actions/combat/aqua_planet"
            }
            .into();
        }
        ui.horizontal(|ui| {
            ui.label(tr("模板档位"));
            egui::ComboBox::from_id_salt("tier")
                .selected_text(tr(["中级", "高级", "顶级"][self.settings.tier_template]))
                .show_ui(ui, |ui| {
                    for (i, n) in ["中级", "高级", "顶级"].iter().enumerate() {
                        ui.selectable_value(&mut self.settings.tier_template, i, tr(*n));
                    }
                });
            if ui.button(tr("整队应用档位")).clicked() {
                for c in &mut self.party {
                    if let Some(t) = self.templates.iter().find(|t| {
                        t.config["name"] == c["name"] && t.tier == self.settings.tier_template
                    }) {
                        *c = t.config.clone();
                    }
                }
            }
        });
        for i in 0..self.party.len() {
            ui.horizontal(|ui| {
                ui.label(tr(format!("站位 {}", i + 1)));
                let mut cls = self.party[i]["name"]
                    .as_str()
                    .unwrap_or("water")
                    .to_string();
                game_icon(
                    ui,
                    &self.res,
                    self.party[i]["equipment"]["weapon"]["itemHrid"]
                        .as_str()
                        .unwrap_or(""),
                    30.,
                );
                egui::ComboBox::from_id_salt(("class", i))
                    .width(45.)
                    .selected_text("")
                    .show_ui(ui, |ui| {
                        for (ci, c) in CLASSES.iter().enumerate() {
                            if workbench::class_button(
                                ui,
                                &self.res,
                                &self.templates,
                                ci,
                                self.settings.tier_template,
                                cls == *c,
                            )
                            .clicked()
                            {
                                self.party[i] = self
                                    .templates
                                    .iter()
                                    .find(|t| {
                                        t.profession == *c && t.tier == self.settings.tier_template
                                    })
                                    .unwrap()
                                    .config
                                    .clone();
                            }
                        }
                    });

                if i > 0 && ui.button(tr("↑")).clicked() {
                    self.party.swap(i, i - 1);
                    self.locks.swap(i, i - 1);
                }
                if ui.button(tr("编辑参数")).clicked() {
                    self.edit = serde_json::to_string_pretty(&self.party[i]).unwrap();
                    self.member_index = i;
                    self.editing_template = false;
                    self.page = 5;
                }
            });
        }
        ui.horizontal(|ui| {
            ui.text_edit_singleline(&mut self.party_name);
            if ui.button(tr("保存阵容")).clicked() {
                let _ = self.store.put(
                    "party",
                    &self.party_name,
                    &json!({"name":self.party_name,"configs":self.party}),
                );
                i18n::register_user_name(&self.party_name);
                self.message = "阵容已保存".into();
            }
            if ui.button(tr("导出阵容")).clicked() {
                self.export("party", json!({"configs":self.party}));
            }
        });
        if let Ok(parties) = self.store.list::<Value>("party") {
            ui.collapsing(tr("已保存阵容"), |ui| {
                for party in parties {
                    if ui
                        .button(tr(party["name"].as_str().unwrap_or("阵容")))
                        .clicked()
                    {
                        self.party = party["configs"].as_array().unwrap().clone();
                        self.locks = vec![false; self.party.len()];
                    }
                }
            });
        }

        ui.add_space(15.);
        if ui.button(tr("单队模拟")).clicked() {
            self.page = 1;
        }
    }
    fn setup(&mut self, ui: &mut egui::Ui) {
        page_title(ui, "模拟台");
        ui.horizontal(|ui| {
            metric_card(
                ui,
                "阵容规模",
                &format!("{} 人", self.party.len()),
                Color32::from_rgb(86, 164, 255),
            );
            metric_card(
                ui,
                "模板基准",
                ["中级 150", "高级 160", "顶级 170"][self.settings.tier_template],
                Color32::from_rgb(81, 205, 174),
            );
            metric_card(
                ui,
                "目标难度",
                &format!("T{}", self.settings.tier),
                Color32::from_rgb(179, 150, 244),
            );
        });
        ui.add_space(18.);
        section(ui, "阵容选择", |ui| {
            if ui.button(tr("配置当前阵容")).clicked() {
                self.page = 0;
                self.config_tab = 0;
            }
            if let Ok(parties) = self.store.list::<Value>("party") {
                for party in parties {
                    if ui
                        .selectable_label(false, tr(party["name"].as_str().unwrap_or("保存的阵容")))
                        .clicked()
                    {
                        self.party = party["configs"].as_array().unwrap().clone();
                        self.locks = vec![false; self.party.len()];
                    }
                }
            }
            ui.label(tr(team_name(&self.party)));
        });
        ui.add_space(12.);
        section(ui, "战斗目标", |ui| {
            let mut dungeon = self.target_size() == 5;
            ui.horizontal(|ui| {
                if ui
                    .selectable_value(&mut dungeon, false, tr("普通星球"))
                    .clicked()
                {
                    self.settings.zone = "/actions/combat/aqua_planet".into();
                }
                if ui
                    .selectable_value(&mut dungeon, true, tr("地牢"))
                    .clicked()
                {
                    self.settings.zone = "/actions/combat/pirate_cove".into();
                }
            });
            ui.horizontal(|ui| {
                ui.label(tr("地图"));
                target_selector(
                    ui,
                    &self.catalog,
                    &self.res,
                    &mut self.settings.zone,
                    dungeon,
                    "simulation-zone",
                );
                ui.label(tr("难度"));
                egui::ComboBox::from_id_salt("simulation-tier")
                    .selected_text(tr(format!("T{}", self.settings.tier)))
                    .show_ui(ui, |ui| {
                        for t in 0..=5 {
                            ui.selectable_value(&mut self.settings.tier, t, tr(format!("T{t}")));
                        }
                    });
            });
            ui.horizontal(|ui| {
                ui.label(tr("模拟时长（小时）"));
                ui.add(egui::DragValue::new(&mut self.settings.hours).range(0.01..=10000.));
                ui.label(tr("随机种子"));
                ui.add(egui::DragValue::new(&mut self.settings.seed));
            });
        });
        let size = self.target_size();
        let valid = self.party.len() == size;
        if !valid {
            ui.colored_label(
                Color32::YELLOW,
                tr(format!(
                    "这个目标需要 {size} 人，当前阵容为 {} 人。",
                    self.party.len()
                )),
            );
            if ui.button(tr(format!("调整当前阵容为 {size} 人"))).clicked() {
                self.resize_party(size);
            }
        }
        ui.add_space(18.);
        ui.horizontal(|ui| {
            if ui
                .add_enabled(
                    valid && !self.active(),
                    egui::Button::new(tr("▶ 运行战斗模拟")).fill(Color32::from_rgb(44, 102, 221)),
                )
                .clicked()
            {
                self.manual();
            }
            if ui.button(tr("自动搜索阵容 →")).clicked() {
                self.page = 2;
            }
        });
        let pr = self.progress.lock().unwrap().clone();
        ui.label(tr(&pr.status));
        if pr.status == "手动模拟完成" {
            if let Some(run) = pr.leaders.first() {
                ui.horizontal(|ui| {
                    metric_card(
                        ui,
                        "成功效率",
                        &format!("{:.2} /h", run.metrics.eph),
                        Color32::from_rgb(81, 205, 174),
                    );
                    metric_card(
                        ui,
                        "团队 DPS",
                        &format!("{:.1}", run.metrics.dps),
                        Color32::from_rgb(86, 164, 255),
                    );
                });
                if ui.button(tr("查看分析报告 →")).clicked() {
                    self.result = Some(run.clone());
                    self.page = 3;
                }
            }
        }
        if !pr.error.is_empty() {
            ui.colored_label(Color32::LIGHT_RED, tr(&pr.error));
        }
    }
    fn analysis(&mut self, ui: &mut egui::Ui) {
        if let Some(r) = self.result.clone() {
            self.result_card(ui, &r, 0, 0, "manual");
        } else {
            ui.label(tr("暂无结果"));
        }
    }
}

fn page_title(ui: &mut egui::Ui, title: &str) {
    ui.heading(tr(title));
    ui.add_space(12.);
}

fn section(ui: &mut egui::Ui, title: &str, body: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(Color32::WHITE)
        .stroke(egui::Stroke::new(1., Color32::from_rgb(230, 234, 240)))
        .corner_radius(18)
        .inner_margin(18.)
        .show(ui, |ui| {
            ui.set_min_width(ui.available_width());
            ui.strong(tr(title));
            ui.add_space(8.);
            body(ui);
        });
}
fn metric_card(ui: &mut egui::Ui, label: &str, value: &str, color: Color32) {
    egui::Frame::new()
        .fill(Color32::WHITE)
        .stroke(egui::Stroke::new(1., Color32::from_rgb(230, 234, 240)))
        .corner_radius(18)
        .inner_margin(16.)
        .show(ui, |ui| {
            ui.with_layout(egui::Layout::top_down(egui::Align::LEFT), |ui| {
                ui.set_width(215.);
                ui.label(tr(
                    RichText::new(label).color(Color32::from_rgb(154, 172, 195))
                ));
                ui.label(tr(RichText::new(value).size(27.).strong().color(color)));
            });
        });
}
fn infer_profession(c: &mut Value, catalog: &Value) {
    if CLASSES.iter().any(|s| c["name"].as_str() == Some(*s)) {
        return;
    }
    let h = c["equipment"]["weapon"]["itemHrid"].as_str().unwrap_or("");
    let stat = &catalog["items"][h]["equipmentDetail"]["combatStats"];
    let damage = stat["damageType"].as_str().unwrap_or("");
    let style = stat["combatStyleHrids"][0].as_str().unwrap_or("");
    let cls = if stat["primaryTraining"] == "/skills/defense" || h.contains("bulwark") {
        "shield"
    } else if damage.ends_with("/water") {
        "water"
    } else if damage.ends_with("/fire") {
        "fire"
    } else if damage.ends_with("/nature") {
        "nature"
    } else if h.contains("crossbow") {
        "crossbow"
    } else if h.contains("bow") || style.ends_with("/ranged") {
        "bow"
    } else if h.contains("spear") || style.ends_with("/stab") {
        "spear"
    } else if style.ends_with("/slash") {
        "sword"
    } else {
        "mace"
    };
    c["displayName"] = c["name"].clone();
    c["name"] = json!(cls);
}
fn sum_object(v: &Value) -> f64 {
    match v {
        Value::Object(m) => m.values().map(sum_object).sum(),
        Value::Array(a) => a.iter().map(sum_object).sum(),
        _ => v.as_f64().unwrap_or(0.),
    }
}
fn sum_json(v: &Value) -> f64 {
    if let Some(a) = v.as_array() {
        a.iter().map(sum_json).sum()
    } else {
        v.as_f64().unwrap_or(0.)
    }
}
fn team_name(cfg: &[Value]) -> String {
    cfg.iter()
        .map(|v| label(v["name"].as_str().unwrap_or("角色")))
        .collect::<Vec<_>>()
        .join(" / ")
}
fn zone_name(c: &Value, h: &str) -> String {
    c["zones"]
        .as_array()
        .and_then(|a| a.iter().find(|z| z["hrid"] == h))
        .and_then(|z| z["name"].as_str())
        .unwrap_or(h)
        .to_owned()
}
#[allow(dead_code)]
fn bar(ui: &mut egui::Ui, value: f64, max: f64, color: Color32) {
    bar_named(ui, value, max, color, "DPS")
}
fn bar_named(ui: &mut egui::Ui, value: f64, max: f64, color: Color32, unit: &str) {
    let (w, h) = (ui.available_width().min(850.), 17.);
    let (rect, _) = ui.allocate_exact_size(egui::vec2(w, h), egui::Sense::hover());
    ui.painter()
        .rect_filled(rect, 3., Color32::from_rgb(33, 43, 58));
    ui.painter().rect_filled(
        egui::Rect::from_min_size(rect.min, egui::vec2(w * (value / max) as f32, h)),
        3.,
        color,
    );
    ui.painter().text(
        rect.right_center(),
        egui::Align2::RIGHT_CENTER,
        format!("{value:.1} {unit}"),
        egui::FontId::proportional(12.),
        Color32::WHITE,
    );
}
fn import_configs(v: &Value) -> anyhow::Result<Vec<Value>> {
    if let Some(a) = v["configs"]
        .as_array()
        .or_else(|| v["playerConfigs"].as_array())
        .or_else(|| v.as_array())
    {
        return Ok(a.clone());
    }
    if let Some(members) = v["members"].as_array() {
        let mut out = vec![];
        for m in members {
            out.push(json!({"id":out.len()+1,"name":m["class_id"],"levels":m["levels"],"equipment":m["equipment"],"food":m["food"],"drinks":m["drinks"],"abilities":m["abilities"],"triggerMap":m["triggers"],"houseRooms":m["house_rooms"],"achievements":m["achievements"],"guildBuffs":m["guild_buffs"]}));
        }
        return Ok(out);
    }
    anyhow::bail!("无法识别角色/队伍 JSON；需要 configs、playerConfigs 或 members")
}
impl eframe::App for App {
    fn ui(&mut self, root: &mut egui::Ui, _: &mut eframe::Frame) {
        root.ctx()
            .request_repaint_after(std::time::Duration::from_millis(250));
        root.ctx()
            .send_viewport_cmd(egui::ViewportCommand::Title(format!(
                "{} v{}",
                i18n::text("职业强度模拟器"),
                env!("CARGO_PKG_VERSION")
            )));
        self.queue_tick();
        for c in &mut self.party {
            remove_task_badges(c);
        }
        root.set_min_size(root.available_size());
        root.visuals_mut().override_text_color = Some(Color32::from_rgb(30, 36, 48));
        egui::Frame::new()
            .fill(Color32::from_rgb(242, 244, 247))
            .show(root, |root| {
                root.horizontal(|ui| {
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let mut en = i18n::english();
                        let old = en;
                        ui.selectable_value(&mut en, true, "EN");
                        ui.selectable_value(&mut en, false, "中文");
                        if en != old {
                            i18n::set_english(en);
                            let _ = self.store.put("preferences", "english", &en);
                        }
                    });
                });
                root.horizontal_top(|ui| {
                    egui::Frame::new()
                        .fill(Color32::from_rgb(247, 249, 252))
                        .inner_margin(16.)
                        .show(ui, |ui| {
                            ui.with_layout(egui::Layout::top_down(egui::Align::LEFT), |ui| {
                                ui.set_width(150.);
                                ui.set_min_height(ui.available_height() - 35.);
                                ui.heading(tr("职业强度\n模拟器"));
                                ui.add_space(25.);
                                for (i, n) in [
                                    (2, "全阵容模拟"),
                                    (4, "历史模拟结果"),
                                    (0, "配置中心"),
                                    (6, "结果对比"),
                                ] {
                                    if ui.selectable_label(self.page == i, tr(n)).clicked() {
                                        self.page = i;
                                    }
                                }
                                ui.add_space(30.);
                                if ui
                                    .add_enabled(!self.active(), egui::Button::new(tr("导入配置")))
                                    .clicked()
                                {
                                    self.import();
                                }
                                ui.separator();
                                ui.add_space(24.);
                                let p = self.progress.lock().unwrap().clone();
                                if p.status == "手动模拟完成" && ui.button(tr("查看结果")).clicked()
                                {
                                    self.result = p.leaders.first().cloned();
                                    self.page = 3;
                                }
                                ui.label(tr(&self.message));
                            });
                        });
                    ui.vertical(|ui| {
                        ui.set_min_width(ui.available_width());
                        egui::ScrollArea::vertical()
                            .id_salt("main-scroll")
                            .show(ui, |ui| {
                                ui.set_min_width(ui.available_width());
                                ui.add_space(16.);
                                match self.page {
                                    0 => self.configuration(ui),
                                    1 => self.setup(ui),
                                    2 => self.queue_page(ui),
                                    3 => self.analysis(ui),
                                    4 => self.reports_page(ui),
                                    6 => self.compare_page(ui),
                                    _ => {
                                        ui.heading(tr(if self.editing_template {
                                            "编辑职业模板"
                                        } else {
                                            "编辑队员"
                                        }));
                                        self.member_editor(ui);
                                        if ui.button(tr("保存成员并返回")).clicked() {
                                            match serde_json::from_str(&self.edit) {
                                                Ok(mut v) => {
                                                    remove_task_badges(&mut v);
                                                    if self.editing_template {
                                                        self.templates[self.selected].config =
                                                            v.clone();
                                                        self.templates[self.selected].version += 1;
                                                        self.template_edit =
                                                            serde_json::to_string_pretty(&v)
                                                                .unwrap();
                                                        let _ = self.store.put(
                                                            "templates",
                                                            "active",
                                                            &self.templates,
                                                        );
                                                        self.refresh_versions();
                                                        self.config_tab = 1;
                                                    } else {
                                                        self.party[self.member_index] = v;
                                                        self.config_tab = 0;
                                                    }
                                                    self.page = 0;
                                                }
                                                Err(e) => self.message = e.to_string(),
                                            }
                                        }
                                    }
                                }
                            });
                    });
                });
            });
    }
}
fn main() -> eframe::Result {
    eframe::run_native(
        "职业强度模拟器",
        eframe::NativeOptions {
            renderer: eframe::Renderer::Wgpu,
            viewport: egui::ViewportBuilder::default()
                .with_title(format!("职业强度模拟器 v{}", env!("CARGO_PKG_VERSION")))
                .with_inner_size([1560., 980.])
                .with_min_inner_size([1280., 800.]),
            ..Default::default()
        },
        Box::new(|cc| Ok(Box::new(App::new(cc)))),
    )
}
fn composition_name(configs: &[Value]) -> String {
    let mut parts = vec![];
    for (i, c) in CLASSES.iter().enumerate() {
        let n = configs.iter().filter(|p| p["name"] == *c).count();
        if n > 0 {
            parts.push(if n == 1 {
                NAMES[i].into()
            } else {
                format!("{}×{}", NAMES[i], n)
            });
        }
    }
    parts.join(" · ")
}
fn slot_label(key: &str) -> &str {
    match key {
        "head" => "头部",
        "body" => "上衣",
        "legs" => "下装",
        "feet" => "鞋子",
        "hands" => "手套",
        "weapon" => "武器",
        "off_hand" => "副手",
        "pouch" => "消耗品囊",
        "neck" => "项链",
        "earrings" => "耳环",
        "ring" => "戒指",
        "back" => "背部",
        "charm" => "护符",
        _ => "其他装备",
    }
}
fn stat_label(key: &str) -> Option<&'static str> {
    Some(match key {
        "damageTaken" => "受到伤害加成",
        "maxHitpointsRatio" => "生命百分比",
        "maxManapointsRatio" => "法力百分比",
        "taskDamage" => "任务伤害",
        "armorDamageRatio" => "护甲伤害系数",
        "hpDrainRatio" => "技能吸血",
        "stabAccuracy" => "刺击命中",
        "slashAccuracy" => "斩击命中",
        "smashAccuracy" => "粉碎命中",
        "rangedAccuracy" => "远程命中",
        "magicAccuracy" => "魔法命中",
        "stabDamage" => "刺击伤害系数",
        "slashDamage" => "斩击伤害系数",
        "smashDamage" => "粉碎伤害系数",
        "rangedDamage" => "远程伤害系数",
        "magicDamage" => "魔法伤害系数",
        "defensiveDamage" => "防御伤害系数",
        "physicalAmplify" => "物理增幅",
        "waterAmplify" => "水系增幅",
        "natureAmplify" => "自然增幅",
        "fireAmplify" => "火系增幅",
        "healingAmplify" => "治疗增幅",
        "stabEvasion" => "刺击闪避",
        "slashEvasion" => "斩击闪避",
        "smashEvasion" => "粉碎闪避",
        "rangedEvasion" => "远程闪避",
        "magicEvasion" => "魔法闪避",
        "armor" => "护甲",
        "waterResistance" => "水抗",
        "natureResistance" => "自然抗性",
        "fireResistance" => "火抗",
        "maxHitpoints" => "最大生命",
        "maxManapoints" => "最大法力",
        "criticalRate" => "暴击率",
        "criticalDamage" => "暴击伤害",
        "attackSpeed" => "攻击速度加成",
        "attackInterval" => "攻击间隔（秒）",
        "castSpeed" => "施法速度",
        "abilityHaste" => "技能急速",
        "tenacity" => "韧性",
        "armorPenetration" => "破甲",
        "waterPenetration" => "水系穿透",
        "naturePenetration" => "自然穿透",
        "firePenetration" => "火系穿透",
        "lifeSteal" => "生命偷取",
        "manaLeech" => "法力偷取",
        "hpRegenPer10" => "每十秒生命回复",
        "mpRegenPer10" => "每十秒法力回复",
        "physicalThorns" => "物理反伤",
        "elementalThorns" => "元素反伤",
        "retaliation" => "反击",
        "threat" => "仇恨",
        "parry" => "招架",
        "mayhem" => "混乱",
        "pierce" => "穿透",
        "curse" => "诅咒每层增伤",
        "fury" => "狂怒",
        "weaken" => "弱化",
        "ripple" => "涟漪",
        "bloom" => "绽放",
        "blaze" => "烈焰",
        "foodSlots" => "额外食物槽",
        "drinkSlots" => "额外饮料槽",
        "foodHaste" => "食物急速",
        "drinkConcentration" => "饮料浓缩",
        "autoAttackDamage" => "普攻伤害",
        "abilityDamage" => "技能伤害",
        "combatDropRate" => "战斗掉落率",
        "combatRareFind" => "稀有掉落率",
        "combatDropQuantity" => "战斗掉落数量",
        "combatExperience" => "战斗经验加成",
        "staminaExperience" => "耐力经验",
        "intelligenceExperience" => "智力经验",
        "attackExperience" => "攻击经验",
        "defenseExperience" => "防御经验",
        "meleeExperience" => "近战经验",
        "rangedExperience" => "远程经验",
        "magicExperience" => "魔法经验",
        _ => return None,
    })
}
fn human_equipment_editor(ui: &mut egui::Ui, item: &mut Value) {
    for (key, title) in [
        ("combatStats", "战斗属性"),
        ("combatEnhancementBonuses", "强化增益"),
    ] {
        egui::CollapsingHeader::new(tr(title))
            .default_open(true)
            .show(ui, |ui| {
                if !item["equipmentDetail"][key].is_object() {
                    item["equipmentDetail"][key] = json!({});
                }
                let stats = item["equipmentDetail"][key].as_object_mut().unwrap();
                let mut delete = None;
                egui::Grid::new(key).striped(true).show(ui, |ui| {
                    for (k, v) in stats.iter_mut() {
                        let Some(label) = stat_label(k) else {
                            continue;
                        };
                        let Some(mut n) = v.as_f64() else {
                            continue;
                        };
                        let percentage = !matches!(
                            k.as_str(),
                            "attackInterval"
                                | "maxHitpoints"
                                | "maxManapoints"
                                | "armor"
                                | "waterResistance"
                                | "natureResistance"
                                | "fireResistance"
                                | "abilityHaste"
                                | "tenacity"
                                | "foodSlots"
                                | "drinkSlots"
                                | "threat"
                        );
                        let scale = if k == "attackInterval" {
                            1e9
                        } else if percentage {
                            0.01
                        } else {
                            1.
                        };
                        n /= scale;
                        ui.label(tr(label));
                        if ui
                            .add(
                                egui::DragValue::new(&mut n)
                                    .speed(0.1)
                                    .max_decimals(2)
                                    .suffix(if percentage { "%" } else { "" }),
                            )
                            .changed()
                        {
                            *v = json!(n * scale);
                        }
                        if ui.small_button(tr("删除")).clicked() {
                            delete = Some(k.clone());
                        }
                        ui.end_row();
                    }
                });
                if let Some(k) = delete {
                    stats.remove(&k);
                }
                egui::ComboBox::from_id_salt((key, "add-property"))
                    .selected_text(tr("＋ 新增词条"))
                    .show_ui(ui, |ui| {
                        for k in mwi_engine::stats::PLAYER_EQUIP_KEYS
                            .iter()
                            .chain(["attackInterval", "foodSlots", "drinkSlots"].iter())
                        {
                            if stats.contains_key(*k) {
                                continue;
                            }
                            if let Some(label) = stat_label(k) {
                                if ui.button(tr(label)).clicked() {
                                    stats.insert(k.to_string(), json!(0.));
                                }
                            }
                        }
                    });
            });
    }
}

fn store_job(home: &std::path::Path) -> String {
    let Ok(db) = Store::open(&home.join("simulator.sqlite")) else {
        return String::new();
    };
    let job = db
        .get::<String>("finite-last-job", "last")
        .ok()
        .flatten()
        .unwrap_or_default();
    if !job.is_empty()
        && db
            .get::<Settings>("finite-job-settings", &job)
            .ok()
            .flatten()
            .is_none()
    {
        if let Ok(Some(cp)) = db.get::<Checkpoint>("checkpoint", &job) {
            let _ = db.put("finite-job-settings", &job, &cp.settings);
            let _ = db.put("finite-job-versions", &job, &cp.versions);
        }
    }
    job
}

fn game_icon(ui: &mut egui::Ui, res: &std::path::Path, h: &str, size: f32) {
    ui.add(icons::image(res, h, size));
}

fn zone_icon(h: &str) -> &str {
    match h.rsplit('/').next().unwrap_or("") {
        "smelly_planet" => "swamp_essence",
        "swamp_planet" => "swamp_essence",
        "aqua_planet" => "aqua_essence",
        "jungle_planet" => "jungle_essence",
        "gobo_planet" => "gobo_essence",
        "sorcerers_tower" => "sorcerer_essence",
        "bear_with_it" => "bear_essence",
        "golem_cave" => "golem_essence",
        "planet_of_the_eyes" => "eyessence",
        "twilight_zone" => "twilight_essence",
        "infernal_abyss" => "abyssal_essence",
        "chimerical_den" => "chimerical_chest",
        "sinister_circus" => "sinister_chest",
        "enchanted_fortress" => "enchanted_chest",
        _ => "pirate_chest",
    }
}
fn target_selector(
    ui: &mut egui::Ui,
    cat: &Value,
    res: &std::path::Path,
    zone: &mut String,
    dungeon: bool,
    id: &str,
) {
    game_icon(ui, res, zone_icon(zone), 32.);
    egui::ComboBox::from_id_salt(id)
        .width(190.)
        .selected_text(tr(zone_name(cat, zone)))
        .show_ui(ui, |ui| {
            for z in cat["zones"].as_array().into_iter().flatten() {
                if (z["combatZoneInfo"]["isDungeon"] == true) == dungeon {
                    if !dungeon
                        && !lineup_simulator::workflow::planet_allowed(
                            z["hrid"].as_str().unwrap_or(""),
                        )
                    {
                        continue;
                    }
                    let h = z["hrid"].as_str().unwrap_or("");
                    ui.horizontal(|ui| {
                        game_icon(ui, res, zone_icon(h), 28.);
                        ui.selectable_value(
                            zone,
                            h.to_owned(),
                            tr(z["name"].as_str().unwrap_or("地图")),
                        );
                    });
                }
            }
        });
}

fn lineup_panel(ui: &mut egui::Ui, cat: &Value, res: &std::path::Path, run: &Run) {
    ui.collapsing(tr("查看阵容技能与光环"), |ui| {
        for (i, c) in run.configs.iter().enumerate() {
            ui.strong(tr(format!(
                "队员{} · {}",
                i + 1,
                label(c["name"].as_str().unwrap_or(""))
            )));
            ui.horizontal_wrapped(|ui| {
                for a in c["abilities"].as_array().into_iter().flatten() {
                    let h = a["abilityHrid"].as_str().unwrap_or("");
                    game_icon(ui, res, h, 26.);
                    ui.label(tr(format!(
                        "{} Lv{}",
                        cat["abilities"][h]["name"].as_str().unwrap_or("技能"),
                        a["level"]
                    )));
                }
            });
            ui.horizontal_wrapped(|ui| {
                for h in c["food"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .chain(c["drinks"].as_array().into_iter().flatten())
                    .filter_map(Value::as_str)
                {
                    game_icon(ui, res, h, 22.);
                    ui.label(tr(cat["items"][h]["name"].as_str().unwrap_or("消耗品")));
                }
            });
        }
    });
}

fn coffee_panel(ui: &mut egui::Ui, cat: &Value, run: &Run) {
    let audit = &run.result["coffeeAdjustment"];
    if !audit.is_object() {
        return;
    }
    ui.collapsing(tr("初筛咖啡选择与耐力调整"), |ui| {
        ui.label(tr(format!(
            "初筛 {} 次 · 搭配 {} 种",
            audit["screenSimulations"], audit["comparedThirdCupChoices"]
        )));
        for (i, c) in run.configs.iter().enumerate() {
            let names = c["drinks"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|h| cat["items"][h]["name"].as_str().unwrap_or("咖啡"))
                .collect::<Vec<_>>()
                .join("＋");
            ui.label(tr(format!(
                "队员{} · {}：{}",
                i + 1,
                label(c["name"].as_str().unwrap_or("")),
                names
            )));
        }
        for change in audit["changes"].as_array().into_iter().flatten() {
            let i = change["member"].as_u64().unwrap_or(0) as usize;
            ui.label(tr(format!(
                "队员{}：暴击→究极耐力，死亡 {:.2}/h → {:.2}/h",
                i + 1,
                change["beforeDeathsPerHour"][i].as_f64().unwrap_or(0.),
                change["afterDeathsPerHour"][i].as_f64().unwrap_or(0.)
            )));
        }
        if audit["remainingDeathsAboveThreshold"]
            .as_array()
            .is_some_and(|a| !a.is_empty())
        {
            ui.label(tr("死亡率仍 >2/h"));
        }
    });
}
