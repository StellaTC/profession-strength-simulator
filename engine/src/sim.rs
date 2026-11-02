//! The combat simulator (`Wt` in the site's worker) and its setup from a compiled scenario.

use crate::data::*;
use crate::js::{self, Rng};
use crate::queue::{Ev, EvType, Queue};
use crate::result::SimResult;
use crate::stats::*;
use crate::unit::*;
use serde_json::{Value, json};
use rustc_hash::FxHashMap as HashMap;
use smallvec::SmallVec;

type Units = SmallVec<[UnitId; 8]>;
use std::rc::Rc;

const X: f64 = 1e9;
const CONSUMABLE_TICK: f64 = 5.0 * X;
const DOT_TICK: f64 = 3.0 * X;
const REGEN_TICK: f64 = 10.0 * X;
const ENEMY_RESPAWN: f64 = 3.0 * X;
const PLAYER_RESPAWN: f64 = 150.0 * X;
const DUNGEON_RESTART: f64 = 3.0 * X;
const ENRAGE_TICK: f64 = 60.0 * X;

pub type SimErr = String;

struct Spawn {
    hrid: String,
    tier: f64,
    rate: f64,
    strength: f64,
}

struct SpawnInfo {
    spawns: Vec<Spawn>,
    max_spawn_count: f64,
    max_total_strength: f64,
}

impl SpawnInfo {
    fn parse(v: &Value) -> SpawnInfo {
        let spawns = match v.get("spawns") {
            Some(Value::Array(list)) => list
                .iter()
                .map(|s| Spawn {
                    hrid: string(s, "combatMonsterHrid"),
                    tier: num(s, "difficultyTier"),
                    rate: num(s, "rate"),
                    strength: num(s, "strength"),
                })
                .collect(),
            _ => Vec::new(),
        };
        SpawnInfo {
            spawns,
            max_spawn_count: num(v, "maxSpawnCount"),
            max_total_strength: num(v, "maxTotalStrength"),
        }
    }
}

fn parse_fixed(v: &Value) -> Vec<(String, f64)> {
    match v {
        Value::Array(list) => list
            .iter()
            .map(|s| (string(s, "combatMonsterHrid"), num(s, "difficultyTier")))
            .collect(),
        _ => Vec::new(),
    }
}

struct Dungeon {
    max_waves: f64,
    /// Object.entries order (integer-like keys ascending) of fixedSpawnsMap
    fixed: Vec<(String, Vec<(String, f64)>)>,
    /// randomSpawnInfoMap sorted by numeric key
    random: Vec<(f64, SpawnInfo)>,
}

struct Zone {
    hrid: String,
    tier: f64,
    is_dungeon: bool,
    random: Option<SpawnInfo>,
    boss: Option<Vec<(String, f64)>>,
    dungeon: Option<Dungeon>,
    encounters_killed: f64,
    dungeons_completed: f64,
    dungeons_failed: f64,
    dungeon_attempts_started: f64,
}

impl Zone {
    fn parse(v: &Value) -> Zone {
        let info = v.get("combatZoneInfo").cloned().unwrap_or(Value::Null);
        let fight = info.get("fightInfo").cloned().unwrap_or(Value::Null);
        let random = fight.get("randomSpawnInfo").map(SpawnInfo::parse);
        let boss = match fight.get("bossSpawns") {
            Some(Value::Array(_)) => Some(parse_fixed(fight.get("bossSpawns").unwrap())),
            _ => None,
        };
        let dungeon = match info.get("dungeonInfo") {
            Some(d @ Value::Object(_)) => {
                let mut fixed = Vec::new();
                if let Some(Value::Object(m)) = d.get("fixedSpawnsMap") {
                    for (k, s) in m {
                        fixed.push((k.clone(), parse_fixed(s)));
                    }
                }
                sort_js_keys(&mut fixed);
                let mut random = Vec::new();
                if let Some(Value::Object(m)) = d.get("randomSpawnInfoMap") {
                    for (k, s) in m {
                        random.push((k.parse::<f64>().unwrap_or(f64::NAN), SpawnInfo::parse(s)));
                    }
                }
                random.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                Some(Dungeon {
                    max_waves: num(d, "maxWaves"),
                    fixed,
                    random,
                })
            }
            _ => None,
        };
        Zone {
            hrid: string(v, "hrid"),
            tier: num(v, "difficultyTier"),
            is_dungeon: matches!(info.get("isDungeon"), Some(Value::Bool(true))),
            random,
            boss,
            dungeon,
            encounters_killed: 1.0,
            dungeons_completed: 0.0,
            dungeons_failed: 0.0,
            dungeon_attempts_started: 0.0,
        }
    }

    fn fail_wave(&mut self) {
        self.dungeons_failed += 1.0;
        self.encounters_killed = 1.0;
    }

    fn complete_dungeon(&mut self) {
        self.dungeons_completed += 1.0;
        self.encounters_killed = 1.0;
    }
}

/// Orders keys like JS objects do: array-index keys ascending first, then insertion order.
fn sort_js_keys<T>(v: &mut Vec<(String, T)>) {
    let is_index = |k: &str| {
        !k.is_empty()
            && k.bytes().all(|b| b.is_ascii_digit())
            && (k == "0" || !k.starts_with('0'))
            && k.len() < 10
    };
    let mut idx: Vec<(String, T)> = Vec::new();
    let mut rest: Vec<(String, T)> = Vec::new();
    for e in v.drain(..) {
        if is_index(&e.0) {
            idx.push(e);
        } else {
            rest.push(e);
        }
    }
    idx.sort_by_key(|e| e.0.parse::<u64>().unwrap());
    v.extend(idx);
    v.extend(rest);
}

struct Lab {
    monster_hrid: String,
    room_level: f64,
    encounter_start: f64,
}

/// JS value produced by a trigger dependency lookup.
enum Val {
    Num(f64),
    Bool(bool),
    Obj(bool),
    Str,
}

#[derive(Clone,Copy,Default,serde::Serialize)]
struct WeaponStats {
 auto_attacks:f64,pierce_triggers:f64,pierce_targets:f64,pierce_hits:f64,pierce_damage:f64,
 mayhem_triggers:f64,retry_hits:f64,retry_damage:f64,parries:f64,parry_damage:f64,
 blaze_triggers:f64,blaze_damage:f64,bloom_triggers:f64,bloom_healing:f64,
 ripple_triggers:f64,ripple_mana:f64,ripple_cooldown_seconds:f64,
 fury_events:f64,fury_layer_seconds:f64,fury_full_seconds:f64,alive_seconds:f64,
 weaken_applications:f64,weaken_refreshes:f64,weaken_layer_seconds:f64,weaken_max_seconds:f64,target_seconds:f64,
 curse_applications:f64,curse_new_strength:f64,
 curse_hit_count:f64,curse_hit_layers:f64,curse_full_hits:f64,
 fury_hit_count:f64,fury_hit_layers:f64,fury_bonus_damage:f64,fury_baseline_damage:f64,
 parry_prevented:f64,weaken_prevented:f64,team_taken:f64,total_healing:f64,bloom_attempted:f64,
}
pub struct Sim<'a> {
    gd: &'a GameData,
    weapon_stats:[WeaponStats;5],
    observe_weapons:bool,
    phase_weapon:HashMap<String,Value>,
    weapon_phase:String,
    phase_start:[WeaponStats;5],
    cooldown_cycles:HashMap<(usize,u32),CooldownCycle>,
    cooldown_observations:HashMap<String,Vec<Value>>,
    bloom_receivers:[[f64;5];5],
    parry_targets:[[f64;5];5],
    fury_damage_layers:[[f64;6];5],
    weaken_owners:HashMap<usize,[f64;5]>,
    it: Interner,
    units: Vec<Unit>,
    players: Rc<[UnitId]>,
    enemies: Option<Rc<[UnitId]>>,
    zone: Option<Zone>,
    lab: Option<Lab>,
    q: Queue,
    time: f64,
    all_dead: bool,
    enrage_begin: f64,
    temp_dungeon_count: f64,
    rng: Rng,
    pub res: SimResult,
    ability_cache: HashMap<String, HashMap<u64, (Rc<AbilityDef>, Rc<Vec<Trigger>>)>>,
    blaze_def: Option<Rc<AbilityDef>>,
    bloom_def: Option<Rc<AbilityDef>>,
    monster_cache: HashMap<String, Rc<MonsterTemplate>>,
    u_fury_acc: u32,
    u_fury_dmg: u32,
    u_curse: u32,
    u_weaken: u32,
    u_enrage_dmg: u32,
    u_enrage_acc: u32,
    s_regen: u32,
    s_lifesteal: u32,
    s_mana_leech: u32,
    s_ripple: u32,
    s_auto: u32,
    s_parry: u32,
    s_dot: u32,
    s_retaliation: u32,
    s_physical_thorns: u32,
    s_elemental_thorns: u32,
    pub events_processed: u64,
    visualize: bool,
    omit_wipe_details: bool,
    wipe_logs: std::collections::VecDeque<Value>,
    trace_limit: usize,
    trace: Vec<Value>,
    trial: Option<crate::trial::Trial>,
    healing_done: Value,
    curse_credit: [[f64; 4]; 5],
    owners: HashMap<usize, [f64;5]>,
    transfers: [[f64;5];5],
    phase_seconds: HashMap<String,f64>,
    attempt_started:Option<f64>,
    attempt_closed_at:f64,
    attempt_durations:Vec<(bool,f64)>,
    phase_damage: HashMap<String,[f64;5]>,
    phase_transfers: HashMap<String,[[f64;5];5]>,
    curse_layer_stats: [[[f64; 6]; 4]; 5],
    curse_direct_hit_hist: [[f64; 6]; 5],
    monster_layer_stats: HashMap<String, [[[f64;6];4];5]>,
    monster_hit_hist: HashMap<String, [[f64;6];5]>,
    boss_wave_layer_stats: [[[f64;6];4];5],
    boss_wave_hit_hist: [[f64;6];5],
    monster_curse_credit: HashMap<String,[[f64;4];5]>,
    boss_wave_curse_credit: [[f64;4];5],
}

fn two<T>(v: &mut [T], a: usize, b: usize) -> (&mut T, &mut T) {
    assert!(a != b);
    if a < b {
        let (x, y) = v.split_at_mut(b);
        (&mut x[a], &mut y[0])
    } else {
        let (x, y) = v.split_at_mut(a);
        (&mut y[0], &mut x[b])
    }
}

struct AttackOut {
    is_crit: bool,
    damage_done: f64,
    curse_bonus: f64,
    curse_snapshot_layers: f64,
    curse_owners: [f64;5],
    did_hit: bool,
    thorn_damage: f64,
    thorn_physical: bool,
    retaliation_damage: f64,
    life_steal_heal: f64,
    hp_drain: f64,
    mana_leech: f64,
}

impl<'a> Sim<'a> {
    pub fn new(gd: &'a GameData, sc: &Value, record_attacks: bool) -> Result<Sim<'a>, SimErr> {
        let mut it = Interner::default();
        for n in BUFF_TYPE_NAMES {
            it.id(n);
        }
        let u_fury_acc = it.id("/buff_uniques/fury_accuracy");
        let u_fury_dmg = it.id("/buff_uniques/fury_damage");
        let u_curse = it.id("/buff_uniques/curse");
        let u_weaken = it.id("/buff_uniques/weaken");
        let u_enrage_dmg = it.id("/buff_uniques/enrage_damage");
        let u_enrage_acc = it.id("/buff_uniques/enrage_accuracy");

        let zone = match sc.get("zone") {
            Some(z @ Value::Object(_)) => Some(Zone::parse(z)),
            _ => None,
        };
        let lab = match sc.get("labyrinth") {
            Some(l @ Value::Object(_)) => Some(Lab {
                monster_hrid: string(l, "monsterHrid"),
                room_level: num(l, "roomLevel"),
                encounter_start: 0.0,
            }),
            _ => None,
        };
        let players_v = sc
            .get("players")
            .and_then(|p| p.as_array())
            .ok_or("scenario has no players")?;
        let trial = sc.get("trial").filter(|v| v.is_object()).map(|v| crate::trial::Trial::new(v, players_v.len())).transpose()?;
        let seed = sc.get("seed").map(to_num).unwrap_or(0.0);
        let res = SimResult::new(
            zone.as_ref().map(|z| (z.hrid.clone(), z.tier)),
            lab.as_ref().map(|l| (l.monster_hrid.clone(), l.room_level)),
            players_v.len(),
            record_attacks,
            &mut it,
        );
        let special: Vec<u32> = ["regen", "lifesteal", "manaLeech", "ripple", "autoAttack", "parry", "damageOverTime", "retaliation", "physicalThorns", "elementalThorns"]
            .iter()
            .map(|n| it.id(n))
            .collect();
        let mut sim = Sim {
            gd,
            it,
            weapon_stats:[WeaponStats::default();5],
            observe_weapons:sc.get("observeWeapons").and_then(Value::as_bool).unwrap_or(true),
            phase_weapon:HashMap::default(),weapon_phase:String::new(),phase_start:[WeaponStats::default();5],
            cooldown_cycles:HashMap::default(),cooldown_observations:HashMap::default(),
            bloom_receivers:[[0.;5];5],parry_targets:[[0.;5];5],fury_damage_layers:[[0.;6];5],weaken_owners:HashMap::default(),
            units: Vec::new(),
            players: Rc::from(Vec::new()),
            enemies: None,
            zone,
            lab,
            q: if trial.is_some() { Queue::trial() } else { Queue::default() },
            trial, healing_done: json!({}),
            curse_credit: [[0.0; 4]; 5],
            owners: HashMap::default(),
            transfers: [[0.0;5];5],
            phase_seconds: HashMap::default(),
            attempt_started:None,
            attempt_closed_at:0.0,
            attempt_durations:Vec::new(),
            phase_damage: HashMap::default(),
            phase_transfers: HashMap::default(),
            curse_layer_stats: [[[0.0; 6]; 4]; 5],
            curse_direct_hit_hist: [[0.0; 6]; 5],
            monster_layer_stats: HashMap::default(),
            monster_hit_hist: HashMap::default(),
            boss_wave_layer_stats: [[[0.0;6];4];5],
            boss_wave_hit_hist: [[0.0;6];5],
            monster_curse_credit: HashMap::default(),
            boss_wave_curse_credit: [[0.0;4];5],
            time: 0.0,
            all_dead: false,
            enrage_begin: 0.0,
            temp_dungeon_count: 0.0,
            rng: Rng::new(seed),
            res,
            ability_cache: HashMap::default(),
            blaze_def: None,
            bloom_def: None,
            monster_cache: HashMap::default(),
            u_fury_acc,
            u_fury_dmg,
            u_curse,
            u_weaken,
            u_enrage_dmg,
            u_enrage_acc,
            s_regen: special[0],
            s_lifesteal: special[1],
            s_mana_leech: special[2],
            s_ripple: special[3],
            s_auto: special[4],
            s_parry: special[5],
            s_dot: special[6],
            s_retaliation: special[7],
            s_physical_thorns: special[8],
            s_elemental_thorns: special[9],
            events_processed: 0,
            visualize: sc.get("enableHpMpVisualization").and_then(Value::as_bool).unwrap_or(false),
            omit_wipe_details: sc.get("omitWipeDetails").and_then(Value::as_bool).unwrap_or(false),
            wipe_logs: std::collections::VecDeque::new(),
            trace_limit: sc.get("traceLimit").and_then(Value::as_u64).unwrap_or(0).min(100_000) as usize,
            trace: Vec::new(),
        };
        let mut ids = Vec::new();
        for p in players_v {
            let u = sim.build_player(p)?;
            sim.units.push(u);
            ids.push(sim.units.len() - 1);
        }
        sim.players = Rc::from(ids);
        Ok(sim)
    }

    fn build_player(&mut self, p: &Value) -> Result<Unit, SimErr> {
        let mut equip = Vec::new();
        if let Some(Value::Object(m)) = p.get("equipStats") {
            for (k, v) in m {
                let i = stat_index(k).ok_or_else(|| format!("unknown stat {}", k))?;
                equip.push((i, to_num(v)));
            }
        }
        let style_hrid = string(p, "combatStyleHrid");
        let xp_weights = xp_weights(
            &string(p, "primaryTraining"),
            &string(p, "focusTraining"),
            self.gd.skill_exp_maps.get(&style_hrid).cloned().flatten().unwrap_or_default(),
        );
        let ps = PlayerStatic {
            xp_weights,
            equip,
            style: Style::parse(&style_hrid),
            style_hrid,
            dtype: DType::parse(&string(p, "damageType")),
            attack_interval: num(p, "attackInterval"),
            primary_training: string(p, "primaryTraining"),
            focus_training: string(p, "focusTraining"),
            food_slots: num(p, "foodSlots"),
            drink_slots: num(p, "drinkSlots"),
            bulwark: matches!(p.get("bulwark"), Some(Value::Bool(true))),
        };
        let mut u = Unit::new_player(&string(p, "hrid"), ps);
        u.hid = self.it.id(&string(p, "hrid"));
        u.trial_rules = self.trial.is_some();
        u.base_hp_regen = p.get("baseHitpointRegenPer10").map(to_num).unwrap_or(0.01);
        u.base_mp_regen = p.get("baseManapointRegenPer10").map(to_num).unwrap_or(0.01);
        if let Some(Value::Array(lv)) = p.get("levels") {
            for (i, x) in lv.iter().enumerate().take(7) {
                u.base_level[i] = to_num(x);
            }
        }
        u.debuff_on_level_gap = match p.get("debuffOnLevelGap") {
            None => f64::NAN,
            Some(x) => to_num(x),
        };
        u.task_damage_enabled = matches!(p.get("taskDamageEnabled"), Some(Value::Bool(true)));
        if let Some(Value::Array(list)) = p.get("abilities") {
            for a in list {
                if a.is_null() {
                    u.abilities.push(None);
                    continue;
                }
                let hrid = string(a, "hrid");
                let level = num(a, "level");
                let def = self.ability_def(&hrid, level)?;
                let triggers: Vec<Trigger> = match a.get("triggers") {
                    Some(Value::Array(ts)) => ts
                        .iter()
                        .map(|t| Trigger::from_def(t, self.gd, &mut self.it))
                        .collect(),
                    _ => return Err("ability without triggers array".into()),
                };
                u.abilities.push(Some(Ability {
                    def,
                    triggers: Rc::new(triggers),
                    last_used: MIN_SAFE_INTEGER,
                }));
            }
        }
        for (key, drink) in [("food", false), ("drinks", true)] {
            if let Some(Value::Array(list)) = p.get(key) {
                for c in list {
                    let slot = if c.is_null() {
                        None
                    } else {
                        Some(self.build_consumable(c)?)
                    };
                    if drink {
                        u.drinks.push(slot);
                    } else {
                        u.food.push(slot);
                    }
                }
            }
        }
        if let Some(Value::Array(list)) = p.get("permanentBuffs") {
            for b in list {
                let pb = PermBuff {
                    unique: self.it.id(&string(b, "uniqueHrid")),
                    typ: self.it.id(&string(b, "typeHrid")),
                    flat: num(b, "flatBoost"),
                    ratio: num(b, "ratioBoost"),
                    duration: num(b, "duration"),
                };
                // exported after generatePermanentBuffs(), already merged by type
                u.permanent.insert(pb.typ, pb);
            }
        }
        Ok(u)
    }

    fn build_consumable(&mut self, c: &Value) -> Result<Consumable, SimErr> {
        let cat = string(c, "categoryHrid");
        let buffs = match c.get("buffs") {
            Some(Value::Array(bs)) => bs
                .iter()
                .map(|b| BuffTemplate::from_def(b, 1.0, &mut self.it))
                .collect(),
            _ => Vec::new(),
        };
        let triggers = match c.get("triggers") {
            Some(Value::Array(ts)) => ts
                .iter()
                .map(|t| Trigger::from_def(t, self.gd, &mut self.it))
                .collect(),
            _ => return Err("consumable without triggers array".into()),
        };
        Ok(Consumable {
            hid: self.it.id(&string(c, "hrid")),
            hrid: Rc::from(string(c, "hrid").as_str()),
            cooldown: num(c, "cooldownDuration"),
            hp_restore: num(c, "hitpointRestore"),
            mp_restore: num(c, "manapointRestore"),
            recovery: num(c, "recoveryDuration"),
            is_food: cat.contains("food"),
            is_drink: cat.contains("drink"),
            buffs,
            triggers,
            last_used: MIN_SAFE_INTEGER,
        })
    }

    fn cached_ability(&mut self, hrid: &str, level: f64) -> Result<&(Rc<AbilityDef>, Rc<Vec<Trigger>>), SimErr> {
        let bits = level.to_bits();
        let have = self
            .ability_cache
            .get(hrid)
            .map(|m| m.contains_key(&bits))
            .unwrap_or(false);
        if !have {
            let d = Rc::new(AbilityDef::build(hrid, level, self.gd, &mut self.it)?);
            let t = Rc::new(d.default_triggers.clone());
            self.ability_cache
                .entry(hrid.to_string())
                .or_default()
                .insert(bits, (d, t));
        }
        Ok(&self.ability_cache[hrid][&bits])
    }

    fn ability_def(&mut self, hrid: &str, level: f64) -> Result<Rc<AbilityDef>, SimErr> {
        Ok(self.cached_ability(hrid, level)?.0.clone())
    }

    /// `new se(hrid, level)` with the data's default triggers.
    fn default_ability(&mut self, hrid: &str, level: f64) -> Result<Ability, SimErr> {
        let (def, triggers) = self.cached_ability(hrid, level)?.clone();
        Ok(Ability {
            def,
            triggers,
            last_used: MIN_SAFE_INTEGER,
        })
    }

    /// `new me(hrid, tier, roomLevel)`
    fn spawn_monster(&mut self, hrid: &str, tier: f64, room_level: f64) -> Result<UnitId, SimErr> {
        let _prof = crate::prof::start("spawn_monster");
        let tpl = match self.monster_cache.get(hrid) {
            Some(t) => t.clone(),
            None => {
                let mut t = MonsterTemplate::build(hrid, self.gd)?;
                t.hid = self.it.id(hrid);
                let t = Rc::new(t);
                self.monster_cache.insert(hrid.to_string(), t.clone());
                t
            }
        };
        let mut u = Unit::new_monster(tpl.clone(), tier, room_level);
        u.trial_rules = self.trial.is_some();
        let o = if room_level <= 0.0 { 100.0 } else { room_level } / 100.0;
        for (s, (ah, lvl, min_tier)) in tpl.abilities.iter().enumerate() {
            if *min_tier > tier {
                continue;
            }
            let ab = self.default_ability(ah, (lvl * o).floor())?;
            while u.abilities.len() <= s {
                u.abilities.push(None);
            }
            u.abilities[s] = Some(ab);
        }
        self.units.push(u);
        Ok(self.units.len() - 1)
    }

    // ------------------------------------------------------------------ main loop

    pub fn result_json(&self) -> Value {
        let mut result = self.res.to_json(&self.it);
        result["weaponEffects"] = json!(self.weapon_stats);
        if self.observe_weapons {
            result["weaponObservationVersion"]=json!(2);
            let mut phase=self.phase_weapon.clone();
            if !self.weapon_phase.is_empty(){merge_weapon_delta(&mut phase,&self.weapon_phase,&self.phase_start,&self.weapon_stats);}
            result["phaseWeaponEffects"]=json!(phase);
            result["rippleCooldowns"]=json!(self.cooldown_observations);
            result["bloomReceivers"]=json!(self.bloom_receivers);
            result["parryTargets"]=json!(self.parry_targets);
            result["furyDamageLayers"]=json!(self.fury_damage_layers);
        }
        result["phaseDamage"] = json!(self.phase_damage);
        result["phaseTransfers"] = json!(self.phase_transfers);
        result["dungeonAttemptDurations"]=json!(self.attempt_durations.iter().map(|(success,seconds)|json!({"successful":success,"seconds":seconds})).collect::<Vec<_>>());
        let finished_seconds:f64=self.attempt_closed_at/1e9;
        result["finishedAttemptSeconds"]=json!(finished_seconds);
        result["unfinishedAttemptSeconds"]=json!(if self.zone.as_ref().is_some_and(|z|z.is_dungeon){(self.time-self.attempt_closed_at)/1e9}else{0.0});
        result["phaseSeconds"] = json!(self.phase_seconds);
        result["curseTransfers"] = json!(self.transfers);
        result["curseAttributionByPlayer"] = json!(self.curse_credit);
        result["curseLayerStatsByPlayer"] = json!(self.curse_layer_stats);
        result["curseDirectHitHistogramByPlayer"] = json!(self.curse_direct_hit_hist);
        result["monsterLayerStats"] = json!(self.monster_layer_stats);
        result["monsterHitHistogram"] = json!(self.monster_hit_hist);
        result["bossWaveLayerStats"] = json!(self.boss_wave_layer_stats);
        result["bossWaveHitHistogram"] = json!(self.boss_wave_hit_hist);
        result["monsterCurseCredit"] = json!(self.monster_curse_credit);
        result["bossWaveCurseCredit"] = json!(self.boss_wave_curse_credit);
        if let Some(trial) = &self.trial {
            result["trial"] = trial.json();
            result["maxDungenonTime"] = json!(0);
            result["labyAttemptCount"] = json!(0);
            result["healingDone"] = self.healing_done.clone();
            let row = |id: &usize| { let u = &self.units[*id]; json!({"hrid":self.it.name(u.hid),"combatDetails":{"currentHitpoints":u.d.hp,"currentManapoints":u.d.mp,"maxHitpoints":u.d.max_hp,"maxManapoints":u.d.max_mp}}) };
            result["finalPlayers"] = json!(self.players.iter().map(row).collect::<Vec<_>>());
            result["finalEnemies"] = json!(self.enemies.iter().flat_map(|ids| ids.iter()).map(row).collect::<Vec<_>>());
        }
        if self.trace_limit > 0 { result["eventTrace"] = json!(self.trace); result["eventCount"] = json!(self.events_processed); result["rngCalls"] = json!(self.rng.calls); }
        result
    }

    pub fn simulate(&mut self, limit: f64) -> Result<(), SimErr> { self.simulate_controlled(limit, &|| true) }

    pub fn simulate_controlled(&mut self, limit: f64, keep_running: &dyn Fn() -> bool) -> Result<(), SimErr> {
        self.q.clear();
        self.time = 0.0;
        self.temp_dungeon_count = 0.0;
        self.q.add(0.0, Ev::CombatStart);
        let mut same_time = 0u64;
        while self.time < limit && !self.trial.as_ref().map(|t| t.ended).unwrap_or(false) {
            if self.events_processed % 4096 == 0 && !keep_running() { return Err("interrupted".into()); }
            let e = match self.q.pop() { Some(e) => e, None if self.trial.is_some() => break, None => return Err("event queue empty".into()) };
            if self.trial.is_some() && e.time > limit { self.time = limit; break; }
            if e.time == self.time {
                same_time += 1;
                // e.g. a weapon with attackInterval 0: the original engine loops forever here
                if same_time > 2_000_000 {
                    return Err("simulation stalled (time does not advance)".into());
                }
            } else {
                same_time = 0;
            }
            if self.observe_weapons {let phase=self.phase_name();if phase!=self.weapon_phase{if !self.weapon_phase.is_empty(){merge_weapon_delta(&mut self.phase_weapon,&self.weapon_phase,&self.phase_start,&self.weapon_stats);}self.phase_start=self.weapon_stats;self.weapon_phase=phase;}}
            let dt=(e.time-self.time)/1e9;
            for &id in self.players.iter(){if id<5&&self.units[id].d.hp>0.0{let u=&self.units[id];self.weapon_stats[id].alive_seconds+=dt;if u.s[FURY]>0.0{let layers=u.combat_buffs.get(&self.u_fury_acc).map(|b|b.ratio/u.s[FURY]).unwrap_or(0.0);self.weapon_stats[id].fury_layer_seconds+=layers*dt;if layers>=4.999{self.weapon_stats[id].fury_full_seconds+=dt;}}}}
            if let Some(enemies)=&self.enemies{for &id in self.players.iter(){let strength=self.units[id].s[WEAKEN];if strength>0.0{for &target in enemies.iter(){let u=&self.units[target];if u.d.hp>0.0{let amount=u.combat_buffs.get(&self.u_weaken).map(|b|-b.ratio).unwrap_or(0.0);let layers=amount/strength;self.weapon_stats[id].target_seconds+=dt;self.weapon_stats[id].weaken_layer_seconds+=layers*dt;if layers>=4.999{self.weapon_stats[id].weaken_max_seconds+=dt;}}}}}}
            let phase = self.phase_name();
            *self.phase_seconds.entry(phase).or_default() += (e.time-self.time)/1e9;
            self.time = e.time;
            if self.observe_weapons {self.settle_cooldowns();}
            let kind = format!("{:?}", e.ev.ty());
            self.process(e.ev)?;
            if let Some(err) = self.res.error.take() {
                return Err(err);
            }
            self.events_processed += 1;
            if self.visualize && self.events_processed % 1000 == 0 { self.snapshot(); }
            if self.trace.len() < self.trace_limit {
                let players: Vec<Value> = self.players.iter().map(|&id| { let u=&self.units[id]; json!([self.it.name(u.hid),u.d.hp,u.d.mp]) }).collect();
                let enemies: Vec<Value> = self.enemies.iter().flat_map(|ids| ids.iter()).map(|&id| { let u=&self.units[id]; json!([self.it.name(u.hid),u.d.hp]) }).collect();
                self.trace.push(json!({"kind":kind,"time":self.time,"players":players,"enemies":enemies,"rngCalls":self.rng.calls}));
            }
        }
        self.finish();
        Ok(())
    }

    fn snapshot(&mut self) {
        self.res.time_series["timestamps"].as_array_mut().unwrap().push(json!(self.time));
        let rows = self.res.time_series["players"].as_object_mut().unwrap();
        for &id in self.players.iter() {
            let u=&self.units[id];
            let row=rows.entry(self.it.name(u.hid).to_string()).or_insert_with(||json!({"hp":[],"mp":[],"maxHp":[],"maxMp":[]}));
            for (key,value) in [("hp",u.d.hp),("mp",u.d.mp),("maxHp",u.d.max_hp),("maxMp",u.d.max_mp)] {
                row[key].as_array_mut().unwrap().push(json!(value));
            }
        }
    }

    fn log_damage(&mut self, source: Option<UnitId>, ability: &str, target: UnitId, damage: f64, critical: bool) {
        if self.omit_wipe_details || !self.zone.as_ref().map(|z| z.is_dungeon).unwrap_or(false) || !self.units[target].is_player { return; }
        let after=self.units[target].d.hp;
        let players: Vec<Value>=self.players.iter().map(|&id| {let u=&self.units[id];json!({"hrid":self.it.name(u.hid),"current":u.d.hp,"max":u.d.max_hp})}).collect();
        let log=json!({"time":self.time,"wave":self.zone.as_ref().unwrap().encounters_killed-1.0,
            "source":source.map(|id|self.it.name(self.units[id].hid)).unwrap_or("UNKNOWN_SOURCE"),
            "ability":ability,"target":self.it.name(self.units[target].hid),"damage":damage,
            "beforeHp":js::max(0.0,after+damage),"afterHp":after,"playersHp":players,"isCrit":critical});
        if self.wipe_logs.len()==200 { self.wipe_logs.pop_front(); }
        self.wipe_logs.push_back(log);
    }

    fn finish(&mut self) {
        let is_dungeon = self.zone.as_ref().map(|z| z.is_dungeon).unwrap_or(false);
        self.res.is_dungeon = is_dungeon;
        if is_dungeon {
            let z = self.zone.as_ref().unwrap();
            self.res.dungeons_completed = z.dungeons_completed;
            self.res.dungeons_failed = z.dungeons_failed;
            self.res.dungeon_attempts_started = z.dungeon_attempts_started;
            let max_waves = z.dungeon.as_ref().map(|d| d.max_waves).unwrap_or(0.0);
            if self.res.dungeons_completed < 1.0 {
                self.res.max_wave_reached = 0.0;
                let mut w = 1.0;
                while w <= max_waves {
                    let name = format!("#{}", js::num_key(w));
                    match self.res.time_spent_alive.iter().find(|t| t.name == name) {
                        Some(t) if t.count != 0.0 => self.res.max_wave_reached = w,
                        _ => break,
                    }
                    w += 1.0;
                }
            } else {
                self.res.max_wave_reached = max_waves;
            }
        }
        self.res.simulated_time = self.time;
        for &p in self.players.iter() {
            let u = &self.units[p];
            let h = u.hid;
            self.res.drop_rate_multiplier.insert(h.clone(), 1.0 + u.s[COMBAT_DROP_RATE]);
            self.res.rare_find_multiplier.insert(h.clone(), 1.0 + u.s[COMBAT_RARE_FIND]);
            self.res.combat_drop_quantity.insert(h.clone(), u.s[COMBAT_DROP_QUANTITY]);
            self.res.debuff_on_level_gap.insert(h.clone(), u.debuff_on_level_gap);
            self.res.mana_used.insert(h, u.mana_costs.clone());
        }
        if is_dungeon {
            let z = self.zone.as_ref().unwrap();
            if let Some(d) = &z.dungeon {
                for (k, list) in &d.fixed {
                    let mut p = format!("#{}", k);
                    for (h, _) in list {
                        p.push(',');
                        p.push_str(h);
                    }
                    self.res.boss_spawns.push(p);
                }
            }
            if let Some(b) = &z.boss {
                for (h, _) in b {
                    self.res.boss_spawns.push(h.clone());
                }
            }
        }
    }

    fn process(&mut self, ev: Ev) -> Result<(), SimErr> {
        let _prof = crate::prof::start("process(all)");
        match ev {
            Ev::CombatStart => self.on_combat_start()?,
            Ev::PlayerRespawn { hrid } => self.on_player_respawn(hrid)?,
            Ev::EnemyRespawn => self.start_new_encounter()?,
            Ev::AutoAttack { source } => self.on_auto_attack(source)?,
            Ev::ConsumableTick {
                source,
                drink,
                slot,
                total,
                current,
            } => self.on_consumable_tick(source, drink, slot, total, current),
            Ev::Dot {
                source_ref,
                target,
                damage,
                total,
                current,
                curse_bonus,
                curse_layers, curse_owners,
            } => self.on_dot(source_ref, target, damage, total, current, curse_bonus, curse_layers, curse_owners)?,
            Ev::CheckBuffExpiration { source } => self.units[source].remove_expired(self.time),
            Ev::RegenTick => self.on_regen(),
            Ev::StunExp { source } => {
                self.units[source].stunned = false;
                self.add_next_attack(source)?;
            }
            Ev::BlindExp { source } => {
                self.units[source].blinded = false;
                self.add_next_attack(source)?;
            }
            Ev::SilenceExp { source } => self.units[source].silenced = false,
            Ev::CurseExp { source, .. } => { self.owners.remove(&source); self.units[source].remove_expired(self.time); }
            Ev::WeakenExp { source, .. } | Ev::FuryExp { source, .. } => {
                self.units[source].remove_expired(self.time)
            }
            Ev::EnrageTick { encounter_time } => self.on_enrage(encounter_time),
            Ev::CastEnd { source, slot } => {
                self.try_use_ability(source, slot)?;
            }
            Ev::AwaitCooldown { source } => self.add_next_attack(source)?,
            Ev::CooldownReady => {}
        }
        self.check_triggers()
    }

    // ------------------------------------------------------------------ encounters

    fn on_combat_start(&mut self) -> Result<(), SimErr> {
        // permanent buffs were generated by the compile step (generatePermanentBuffs at t=0)
        let t = if self.lab.is_some() { 0.0 } else { self.time };
        for i in 0..self.players.len() {
            let p = self.players[i];
            let rng = &mut self.rng;
            self.units[p].reset(t, rng);
        }
        self.q.add(self.time + REGEN_TICK, Ev::RegenTick);
        self.start_new_encounter()
    }

    fn on_player_respawn(&mut self, hrid: u32) -> Result<(), SimErr> {
        let p = *self
            .players
            .iter()
            .find(|&&p| self.units[p].hid == hrid)
            .ok_or("respawn of unknown player")?;
        {
            let u = &mut self.units[p];
            u.remove_expired(self.time);
            u.d.hp = u.d.max_hp;
            u.d.mp = u.d.max_mp;
            u.clear_ccs();
        }
        if self.all_dead {
            self.all_dead = false;
            self.start_attacks()
        } else {
            self.add_next_attack(p)
        }
    }

    fn start_new_encounter(&mut self) -> Result<(), SimErr> {
        let _prof = crate::prof::start("start_new_encounter");
        if self.all_dead {
            self.all_dead = false;
            if let Some(z) = &mut self.zone {
                if !z.is_dungeon || z.encounters_killed != 1.0 {
                    z.fail_wave();
                }
            }
        }
        if self.zone.is_some() {
            let is_dungeon = self.zone.as_ref().unwrap().is_dungeon;
            if !is_dungeon {
                let e = self.random_encounter()?;
                self.enemies = Some(Rc::from(e));
            } else {
                let e = self.next_wave()?;
                self.enemies = Some(Rc::from(e));
                let k = self.zone.as_ref().unwrap().encounters_killed;
                self.res
                    .update_time_spent_alive(&format!("#{}", js::num_key(k - 1.0)), true, self.time);
                let t = self.zone.as_ref().unwrap().dungeons_completed;
                if t > self.temp_dungeon_count {
                    self.temp_dungeon_count = t;
                    for &p in self.players.iter() {
                        let u = &mut self.units[p];
                        u.d.hp = u.d.max_hp;
                        u.d.mp = u.d.max_mp;
                    }
                }
            }
        }
        if self.lab.is_some() {
            let (h, rl) = {
                let l = self.lab.as_ref().unwrap();
                (l.monster_hrid.clone(), l.room_level)
            };
            let m = self.spawn_monster(&h, 0.0, rl)?;
            self.enemies = Some(Rc::from(vec![m]));
            self.lab.as_mut().unwrap().encounter_start = self.time;
        }
        if let Some(trial) = &mut self.trial {
            trial.started = self.time;
            let (monsters, level, count) = (trial.monsters.clone(), trial.level, trial.participants);
            let mut ids = Vec::new();
            for h in monsters {
                let id = self.spawn_monster(&h, 0.0, level as f64)?;
                self.units[id].trial_participants = Some(count); ids.push(id);
            }
            self.enemies = Some(Rc::from(ids));
        }
        let enemies = self.enemies.clone().ok_or("no enemies for encounter")?;
        for &e in enemies.iter() {
            let rng = &mut self.rng;
            self.units[e].reset(self.time, rng);
            let h = self.units[e].hid;
            self.res.update_time_spent_alive(self.it.name(h), true, self.time);
        }
        self.q.clear_type(EvType::EnrageTick);
        self.q.add(
            self.time + ENRAGE_TICK,
            Ev::EnrageTick {
                encounter_time: ENRAGE_TICK,
            },
        );
        self.enrage_begin = self.time;
        self.q.clear_type(EvType::CastEnd);
        self.check_triggers()?;
        self.start_attacks()
    }

    fn build_encounter(&mut self, which: Option<f64>) -> Result<Vec<UnitId>, SimErr> {
        // which: None => zone.random, Some(k) => dungeon random map entry k
        let mut picked: Vec<(String, f64)> = Vec::new();
        {
            let z = self.zone.as_ref().unwrap();
            let info = match which {
                None => z.random.as_ref().ok_or("zone without randomSpawnInfo")?,
                Some(k) => {
                    &z.dungeon
                        .as_ref()
                        .unwrap()
                        .random
                        .iter()
                        .find(|e| e.0 == k)
                        .ok_or("missing random spawn info")?
                        .1
                }
            };
            let mut total = 0.0;
            for s in &info.spawns {
                total += s.rate;
            }
            let mut strength = 0.0;
            let mut n = 0.0;
            'outer: while n < info.max_spawn_count {
                let o = total * self.rng.next();
                let mut acc = 0.0;
                for l in &info.spawns {
                    acc += l.rate;
                    if o <= acc {
                        strength += l.strength;
                        if strength <= info.max_total_strength {
                            picked.push((l.hrid.clone(), l.tier));
                        } else {
                            break 'outer;
                        }
                        break;
                    }
                }
                n += 1.0;
            }
        }
        let zt = self.zone.as_ref().unwrap().tier;
        let mut out = Vec::new();
        for (h, t) in picked {
            out.push(self.spawn_monster(&h, t + zt, 0.0)?);
        }
        Ok(out)
    }

    fn random_encounter(&mut self) -> Result<Vec<UnitId>, SimErr> {
        let z = self.zone.as_mut().unwrap();
        if z.boss.is_some() && z.encounters_killed == 10.0 {
            z.encounters_killed = 1.0;
            let list = z.boss.clone().unwrap();
            let zt = z.tier;
            let mut out = Vec::new();
            for (h, t) in list {
                out.push(self.spawn_monster(&h, t + zt, 0.0)?);
            }
            Ok(out)
        } else {
            z.encounters_killed += 1.0;
            self.build_encounter(None)
        }
    }

    fn close_attempt(&mut self,success:bool){if self.attempt_started.take().is_some(){self.attempt_durations.push((success,((self.time-self.attempt_closed_at)/1e9).max(0.0)));self.attempt_closed_at=self.time;}}
    fn next_wave(&mut self) -> Result<Vec<UnitId>, SimErr> {
        let z=self.zone.as_ref().unwrap();let fallback_complete=z.encounters_killed>z.dungeon.as_ref().unwrap().max_waves;
        if fallback_complete{self.close_attempt(true);}
        if fallback_complete||self.zone.as_ref().unwrap().encounters_killed==1.0{self.attempt_started=Some(self.time);}

        let z = self.zone.as_mut().unwrap();
        let d = z.dungeon.as_ref().ok_or("dungeon zone without dungeonInfo")?;
        if z.encounters_killed > d.max_waves {
            z.complete_dungeon();
        }
        if z.encounters_killed == 1.0 {
            z.dungeon_attempts_started += 1.0;
        }
        let d = z.dungeon.as_ref().unwrap();
        let key = js::num_key(z.encounters_killed);
        if let Some((_, list)) = d.fixed.iter().find(|(k, _)| *k == key) {
            let list = list.clone();
            z.encounters_killed += 1.0;
            let zt = z.tier;
            let mut out = Vec::new();
            for (h, t) in list {
                out.push(self.spawn_monster(&h, t + zt, 0.0)?);
            }
            return Ok(out);
        }
        let keys: Vec<f64> = d.random.iter().map(|e| e.0).collect();
        let k = z.encounters_killed;
        let mut chosen = None;
        if k > *keys.last().ok_or("empty randomSpawnInfoMap")? {
            chosen = Some(*keys.last().unwrap());
        } else {
            for o in 0..keys.len().saturating_sub(1) {
                if k >= keys[o] && k <= keys[o + 1] {
                    chosen = Some(keys[o]);
                    break;
                }
            }
        }
        let chosen = chosen.ok_or("no random spawn info for wave")?;
        let out = self.build_encounter(Some(chosen))?;
        self.zone.as_mut().unwrap().encounters_killed += 1.0;
        Ok(out)
    }

    fn start_attacks(&mut self) -> Result<(), SimErr> {
        let mut all: Units = self.players.iter().copied().collect();
        if let Some(e) = &self.enemies {
            all.extend(e.iter().copied());
        }
        for t in all {
            if self.units[t].d.hp <= 0.0 {
                continue;
            }
            self.add_next_attack(t)?;
        }
        Ok(())
    }

    fn get_target(&self, list: Option<&[UnitId]>) -> Option<UnitId> {
        list?.iter().copied().find(|&u| self.units[u].d.hp > 0.0)
    }

    fn check_parry(&mut self, list: &[UnitId]) -> Option<UnitId> {
        let t: Units = list
            .iter()
            .copied()
            .filter(|&a| self.units[a].d.hp > 0.0 && self.units[a].s[PARRY] > 0.0)
            .collect();
        if t.is_empty() {
            return None;
        }
        // Live combat checks defenders in party order, at most five.
        for id in t.into_iter().take(5) {
            if self.units[id].s[PARRY] > self.rng.next() {
                return Some(id);
            }
        }
        None
    }

    fn pick_by_threat(&mut self, list: &[UnitId]) -> Result<UnitId, SimErr> {
        let mut p = 0.0;
        let mut ranges: SmallVec<[(UnitId, f64, f64); 8]> = SmallVec::new();
        for &f in list {
            let k = self.units[f].s[THREAT];
            p += k;
            ranges.push((f, p - k, p));
        }
        let h = self.rng.next() * p;
        ranges
            .iter()
            .find(|r| h >= r.1 && h < r.2)
            .map(|r| r.0)
            .ok_or_else(|| "threat roll out of range".to_string())
    }

    fn opponents(&self, u: UnitId) -> Option<Rc<[UnitId]>> {
        if self.units[u].is_player {
            self.enemies.clone()
        } else {
            Some(self.players.clone())
        }
    }

    // A queued cast/CC recovery may outlive its encounter. Retired monsters
    // must not act against a later wave; sourceRef DOTs still settle normally.
    fn current_combatant(&self, u: UnitId) -> bool {
        self.units[u].is_player || self.enemies.as_ref().is_some_and(|ids| ids.contains(&u))
    }

    fn allies(&self, u: UnitId) -> Option<Rc<[UnitId]>> {
        if self.units[u].is_player {
            Some(self.players.clone())
        } else {
            self.enemies.clone()
        }
    }

    fn kill(&mut self, u: UnitId) {
        self.cooldown_cycles.retain(|(id,_),_|*id!=u);
        let _prof = crate::prof::start("kill");
        self.q.clear_for_unit(u);
        let h = self.units[u].hid;
        self.res.add_death(h);
        if !self.units[u].is_player {
            self.res.update_time_spent_alive(self.it.name(h), false, self.time);
        }
    }

    fn thorn_name(&self, physical: bool) -> u32 {
        if physical {
            self.s_physical_thorns
        } else {
            self.s_elemental_thorns
        }
    }

    fn on_auto_attack(&mut self, source: UnitId) -> Result<(), SimErr> {
        if !self.current_combatant(source) { return Ok(()); }
        let _prof = crate::prof::start("on_auto_attack");
        let t = match self.opponents(source) {
            Some(t) => t,
            None => return Ok(()),
        };
        let i: Units = t
            .iter()
            .copied()
            .filter(|&s| self.units[s].d.hp > 0.0)
            .collect();
        let src_is_player = self.units[source].is_player;
        if src_is_player{self.weapon_stats[source].auto_attacks+=1.0;}
        let mut reason=0;let mut pierced=false;let mut retried=false;
        for s in 0..i.len() {
            let mut l = i[s];
            if !src_is_player && i.len() > 1 {
                l = self.pick_by_threat(&i)?;
            }
            let mut c = source;
            let u = self.check_parry(&t);
            if self.observe_weapons&&!src_is_player&&u.is_some(){let pu=u.unwrap();let prevented=probe_direct_damage(&self.units[source],&self.units[l],None,self.rng.clone());self.weapon_stats[pu].parry_prevented+=prevented;if l<5{self.parry_targets[pu][l]+=1.;}}
            if let Some(pu) = u {
                l = c;
                c = pu;
            }
            let r = self.process_attack(c, l, None)?;
            if r.did_hit && r.damage_done > 0.0 { self.log_damage(Some(c), "autoAttack", l, r.damage_done, r.is_crit); }
            if c<self.players.len()&&!self.units[l].is_player{if u.is_some(){self.weapon_stats[c].parries+=1.0;self.weapon_stats[c].parry_damage+=r.damage_done;}else if reason==1{self.weapon_stats[c].pierce_targets+=1.0;if r.did_hit{self.weapon_stats[c].pierce_hits+=1.0;self.weapon_stats[c].pierce_damage+=r.damage_done;}}else if reason==2&&r.did_hit{self.weapon_stats[c].retry_hits+=1.0;self.weapon_stats[c].retry_damage+=r.damage_done;}}
            let g = u.is_none() && self.units[c].s[MAYHEM] > self.rng.next();
            if u.is_none() && r.did_hit && self.units[c].s[CURSE] > 0.0 {
                let amt = self.units[c].s[CURSE];
                self.apply_capped_debuff(l, amt, true, c);
            }
            if u.is_none() && self.units[c].s[FURY] > 0.0 {
                self.fury(c, r.did_hit, true);
            }
            if u.is_none() && self.units[l].s[WEAKEN] > 0.0 {
                let amt = self.units[l].s[WEAKEN];
                self.apply_capped_debuff(c, amt, false, l);
            }
            if !g || (g && r.did_hit) || (g && s == i.len() - 1) {
                let name = if u.is_some() {
                    self.s_parry
                } else {
                    self.s_auto
                };
                let (ch, lh) = (self.units[c].hid, self.units[l].hid);
                self.res
                    .add_attack(ch, lh, name, if r.did_hit { Some(r.damage_done) } else { None });
            }
            let (ch, lh) = (self.units[c].hid, self.units[l].hid);
            if r.life_steal_heal > 0.0 {
                self.res.add_hp_gained(ch, self.s_lifesteal, r.life_steal_heal);
            }
            if r.mana_leech > 0.0 {
                self.res.add_mp_gained(ch, self.s_mana_leech, r.mana_leech);
            }
            if r.thorn_damage > 0.0 {
                let tn = self.thorn_name(r.thorn_physical);
                self.res.add_attack(lh, ch, tn, Some(r.thorn_damage));
            }
            if r.thorn_damage > 0.0 { self.log_damage(Some(l), if r.thorn_physical {"physicalThorns"} else {"elementalThorns"}, c, r.thorn_damage, false); }
            if self.units[l].s[RETALIATION] > 0.0 {
                let rn = self.s_retaliation;
                self.res.add_attack(
                    lh,
                    ch,
                    rn,
                    if r.retaliation_damage > 0.0 { Some(r.retaliation_damage) } else { None },
                );
            }
            if r.retaliation_damage > 0.0 { self.log_damage(Some(l), "retaliation", c, r.retaliation_damage, false); }
            if self.units[l].d.hp == 0.0 {
                self.kill(l);
            }
            if self.units[c].d.hp == 0.0 && (r.thorn_damage != 0.0 || r.retaliation_damage != 0.0) {
                self.kill(c);
                break;
            }
            if g&&!r.did_hit {reason=2;if c<self.players.len()&&!retried&&s+1<i.len(){self.weapon_stats[c].mayhem_triggers+=1.0;retried=true;}}
            else {
                if !r.did_hit||u.is_some(){break;}
                if self.units[c].s[PIERCE]<=self.rng.next(){break;}
                reason=1;if c<self.players.len()&&!pierced{self.weapon_stats[c].pierce_triggers+=1.0;pierced=true;}
            }
        }
        if !self.check_encounter_end()? {
            self.add_next_attack(source)?;
        }
        Ok(())
    }

    fn phase_name(&self)->String { self.enemies.as_ref().and_then(|ids| ids.iter().find(|id| self.gd.monsters.get(self.units[**id].hrid.as_ref()).is_some_and(|m|m["isBoss"]==true))).map(|id|self.units[*id].hrid.to_string()).unwrap_or_else(||"normal".into()) }
    fn live_curse_layers(&self, target: UnitId) -> f64 {
        self.owners.get(&target).map(|owners| owners.iter().enumerate().map(|(i,w)| if i<self.players.len() && self.units[i].s[CURSE]>0.0 { w/self.units[i].s[CURSE] } else {0.0}).sum::<f64>()).unwrap_or(0.0)
    }
    fn process_attack(
        &mut self,
        src: UnitId,
        tgt: UnitId,
        eff: Option<&Effect>,
    ) -> Result<AttackOut, SimErr> {
        self.process_attack_kind(src, tgt, eff, eff.is_some())
    }

    fn process_attack_kind(&mut self, src: UnitId, tgt: UnitId, eff: Option<&Effect>, is_ability: bool) -> Result<AttackOut, SimErr> {
        let _prof = crate::prof::start("process_attack");
        let boss_wave = self.enemies.as_ref().is_some_and(|ids| ids.iter().any(|id| self.gd.monsters.get(self.units[*id].hrid.as_ref()).is_some_and(|m|m["isBoss"]==true)));
        let curse_unique = self.u_curse;
        let phase = self.phase_name();
        let target_layers = self.live_curse_layers(tgt);
        let source_layers = self.live_curse_layers(src);
        let target_owners = self.owners.get(&tgt).copied().unwrap_or([0.0;5]);
        let source_owners = self.owners.get(&src).copied().unwrap_or([0.0;5]);
        let mut fury_baseline=None;let mut unweakened=None;
        let fury_layers=if self.units[src].s[FURY]>0. {self.units[src].combat_buffs.get(&self.u_fury_acc).map(|b|b.ratio/self.units[src].s[FURY]).unwrap_or(0.)}else{0.};
        if self.observe_weapons {
            if src<self.players.len()&&!self.units[tgt].is_player&&fury_layers>0. {
                let mut shadow=self.units[src].clone();shadow.remove_buffs(&[self.u_fury_acc,self.u_fury_dmg]);
                fury_baseline=Some(probe_direct_damage_kind(&shadow,&self.units[tgt],eff,is_ability,self.rng.clone()));
            }
            if !self.units[src].is_player&&tgt<self.players.len()&&self.units[src].combat_buffs.contains_key(&self.u_weaken){
                let mut shadow=self.units[src].clone();shadow.remove_buffs(&[self.u_weaken]);
                unweakened=Some(probe_direct_damage_kind(&shadow,&self.units[tgt],eff,is_ability,self.rng.clone()));
            }
        }
        let (e, t) = two(&mut self.units, src, tgt);
        let target_curse = t.combat_buffs.get(&curse_unique).map(|b| b.flat).unwrap_or(0.0);
        let source_curse = e.combat_buffs.get(&curse_unique).map(|b| b.flat).unwrap_or(0.0);
        let rng = &mut self.rng;
        let style = eff.map(|x| x.style).unwrap_or(e.style);
        let dtype = eff.map(|x| x.dtype).unwrap_or(e.dtype);
        let (mut o, s, l) = match style {
            Style::Stab => (e.d.acc[IDX_STAB], e.d.max_dmg[IDX_STAB], t.d.eva[IDX_STAB]),
            Style::Slash => (e.d.acc[IDX_SLASH], e.d.max_dmg[IDX_SLASH], t.d.eva[IDX_SLASH]),
            Style::Smash => (e.d.acc[IDX_SMASH], e.d.max_dmg[IDX_SMASH], t.d.eva[IDX_SMASH]),
            Style::Ranged => (e.d.acc[IDX_RANGED], e.d.max_dmg[IDX_RANGED], t.d.eva[IDX_RANGED]),
            Style::Magic => (e.d.acc[IDX_MAGIC], e.d.max_dmg[IDX_MAGIC], t.d.eva[IDX_MAGIC]),
            Style::Other => return Err("Unknown combat style".into()),
        };
        let (c, u, pen, g, p, h, thorn_physical) = match dtype {
            DType::Physical => (
                1.0 + e.s[PHYSICAL_AMPLIFY],
                e.d.total_armor,
                e.s[ARMOR_PENETRATION],
                t.d.total_armor,
                t.s[PHYSICAL_THORNS],
                t.s[ARMOR_PENETRATION],
                true,
            ),
            DType::Water => (
                1.0 + e.s[WATER_AMPLIFY],
                e.d.total_water_res,
                e.s[WATER_PENETRATION],
                t.d.total_water_res,
                t.s[ELEMENTAL_THORNS],
                t.s[WATER_PENETRATION],
                false,
            ),
            DType::Nature => (
                1.0 + e.s[NATURE_AMPLIFY],
                e.d.total_nature_res,
                e.s[NATURE_PENETRATION],
                t.d.total_nature_res,
                t.s[ELEMENTAL_THORNS],
                t.s[NATURE_PENETRATION],
                false,
            ),
            DType::Fire => (
                1.0 + e.s[FIRE_AMPLIFY],
                e.d.total_fire_res,
                e.s[FIRE_PENETRATION],
                t.d.total_fire_res,
                t.s[ELEMENTAL_THORNS],
                t.s[FIRE_PENETRATION],
                false,
            ),
            DType::Other => return Err("Unknown damage type".into()),
        };
        let r_crit = e.s[CRITICAL_RATE];
        let pe = e.s[CRITICAL_DAMAGE];
        if let Some(i) = eff {
            o *= 1.0 + i.bonus_accuracy_ratio;
        }
        let po = js::pow(o, 1.4);
        let f = po / (po + js::pow(l, 1.4));
        let mut k = 0.0;
        if style == Style::Ranged {
            k = 0.3 * f;
        }
        k = k + r_crit;
        let n_flat = eff.map(|i| i.damage_flat).unwrap_or(0.0);
        let j_ratio = eff.map(|i| i.damage_ratio).unwrap_or(1.0);
        let j = eff.map(|i| i.armor_damage_ratio * e.d.total_armor).unwrap_or(0.0);
        let mut lo = c * (1.0 + n_flat + j);
        let mut hi = c * (j_ratio * s + n_flat + j);
        let is_crit = rng.next() < k;
        if is_crit {
            hi = hi * (1.0 + pe);
            lo = hi;
        }
        let boost = direct_damage_boost(e, t, is_ability, t.s[DAMAGE_TAKEN]);
        let without_curse = direct_damage_boost(e, t, is_ability, t.s[DAMAGE_TAKEN] - target_curse);
        let mut shadow_rng = rng.clone();
        let q_without_curse = random_int(&mut shadow_rng, lo * without_curse, hi * without_curse);
        let q = random_int(rng, lo * boost, hi * boost);
        let mut dmg = 0.0;
        let mut curse_bonus = 0.0;
        let mut thorn = 0.0;
        let mut hit = false;
        if rng.next() < f {
            hit = true;
            let mut tt = g;
            if pen > 0.0 && g > 0.0 {
                tt = g / (1.0 + pen);
            }
            let mut w = 100.0 / (100.0 + tt);
            if tt < 0.0 {
                w = (100.0 - tt) / 100.0;
            }
            let de = (w * q).ceil();
            dmg = js::min(de, t.d.hp);
            if e.is_player && !t.is_player && dmg > 0.0 {
                self.phase_damage.entry(phase.clone()).or_insert([0.0;5])[src] += dmg;
                let layers = target_layers;
                record_layer_stats(&mut self.curse_layer_stats[src][0], layers, layers, dmg);
                self.curse_direct_hit_hist[src][layers.clamp(0.0,5.0) as usize] += 1.0;
                record_layer_stats(&mut self.monster_layer_stats.entry(t.hrid.to_string()).or_insert([[[0.0;6];4];5])[src][0],layers,layers,dmg);
                self.monster_hit_hist.entry(t.hrid.to_string()).or_insert([[0.0;6];5])[src][layers.clamp(0.0,5.0) as usize] += 1.0;
                if boss_wave {
                    record_layer_stats(&mut self.boss_wave_layer_stats[src][0],layers,layers,dmg);
                    self.boss_wave_hit_hist[src][layers.clamp(0.0,5.0) as usize] += 1.0;
                }
            }
            if e.is_player && !t.is_player && target_curse > 0.0 {
                curse_bonus = (dmg - js::min((w * q_without_curse).ceil(), t.d.hp)).max(0.0);
                allocate(&mut self.transfers, src, curse_bonus, target_owners);
                allocate(self.phase_transfers.entry(phase.clone()).or_insert([[0.0;5];5]), src, curse_bonus, target_owners);
                self.curse_credit[src][0] += curse_bonus;
                self.monster_curse_credit.entry(t.hrid.to_string()).or_insert([[0.0;4];5])[src][0] += curse_bonus;
                if boss_wave {self.boss_wave_curse_credit[src][0] += curse_bonus;}
            }
            t.d.hp -= dmg;
        }
        if p > 0.0 && g > -99.0 {
            let mut tt = u;
            if u > 0.0 {
                tt = u / (1.0 + h);
            }
            let mut w = 100.0 / (100.0 + tt);
            if tt < 0.0 {
                w = (100.0 - tt) / 100.0;
            }
            let de = 1.0 + if t.task_damage_enabled { t.s[TASK_DAMAGE] } else { 0.0 };
            let ttk = 1.0 + e.s[DAMAGE_TAKEN];
            let it = de * ttk;
            let mut shadow_rng = rng.clone();
            let fe = random_int(rng, 1.0, it * t.d.defensive_max_damage * (1.0 + g / 100.0) * p);
            let no_curse_roll = random_int(&mut shadow_rng, 1.0, de * (ttk-source_curse) * t.d.defensive_max_damage * (1.0 + g / 100.0) * p);
            let ge = (w * fe).ceil();
            thorn = js::min(ge, e.d.hp);
            if t.is_player && !e.is_player && thorn > 0.0 {
                self.phase_damage.entry(phase.clone()).or_insert([0.0;5])[tgt] += thorn;
                let layers = source_layers;
                record_layer_stats(&mut self.curse_layer_stats[tgt][2],layers,layers,thorn);
                record_layer_stats(&mut self.monster_layer_stats.entry(e.hrid.to_string()).or_insert([[[0.0;6];4];5])[tgt][2],layers,layers,thorn);
                if boss_wave {record_layer_stats(&mut self.boss_wave_layer_stats[tgt][2],layers,layers,thorn);}
            }
            if t.is_player && !e.is_player && source_curse > 0.0 {
                let bonus = (thorn-js::min((w*no_curse_roll).ceil(),e.d.hp)).max(0.0);
                allocate(&mut self.transfers, tgt, bonus, source_owners);
                allocate(self.phase_transfers.entry(phase.clone()).or_insert([[0.0;5];5]), tgt, bonus, source_owners);
                self.curse_credit[tgt][2] += bonus;
                self.monster_curse_credit.entry(e.hrid.to_string()).or_insert([[0.0;4];5])[tgt][2] += bonus;
                if boss_wave {self.boss_wave_curse_credit[tgt][2] += bonus;}
            }
            e.d.hp -= thorn;
        }
        let mut ret = 0.0;
        if t.s[RETALIATION] > 0.0 {
            let pa = js::pow(t.d.acc[IDX_SMASH], 1.4);
            let ratio = pa / (pa + js::pow(e.d.eva[IDX_SMASH], 1.4));
            if ratio > rng.next() {
                let mut w = e.d.total_armor;
                if w > 0.0 {
                    w = w / (1.0 + t.s[ARMOR_PENETRATION]);
                }
                let mut ee = 100.0 / (100.0 + w);
                if w < 0.0 {
                    ee = (100.0 - w) / 100.0;
                }
                let tt = 1.0 + if t.task_damage_enabled { t.s[TASK_DAMAGE] } else { 0.0 };
                let it = 1.0 + e.s[DAMAGE_TAKEN];
                let fe = tt * it;
                let mut ge = q;
                ge = js::min(ge, t.d.defensive_max_damage * 5.0);
                let ni = fe * t.s[RETALIATION] * ge;
                let ji = fe * t.s[RETALIATION] * (t.d.defensive_max_damage + ge);
                let mut shadow_rng = rng.clone();
                let ui = random_int(rng, ni, ji);
                let no_curse_fe = tt * (it-source_curse);
                let no_curse_roll = random_int(&mut shadow_rng, no_curse_fe * t.s[RETALIATION] * ge, no_curse_fe * t.s[RETALIATION] * (t.d.defensive_max_damage+ge));
                let vi = (ee * ui).ceil();
                ret = js::min(vi, e.d.hp);
                if t.is_player && !e.is_player && ret > 0.0 {
                    self.phase_damage.entry(phase.clone()).or_insert([0.0;5])[tgt] += ret;
                    let layers = source_layers;
                    record_layer_stats(&mut self.curse_layer_stats[tgt][3],layers,layers,ret);
                    record_layer_stats(&mut self.monster_layer_stats.entry(e.hrid.to_string()).or_insert([[[0.0;6];4];5])[tgt][3],layers,layers,ret);
                    if boss_wave {record_layer_stats(&mut self.boss_wave_layer_stats[tgt][3],layers,layers,ret);}
                }
                if t.is_player && !e.is_player && source_curse > 0.0 {
                    let bonus = (ret-js::min((ee*no_curse_roll).ceil(),e.d.hp)).max(0.0);
                    allocate(&mut self.transfers, tgt, bonus, source_owners);
                allocate(self.phase_transfers.entry(phase.clone()).or_insert([[0.0;5];5]), tgt, bonus, source_owners);
                    self.curse_credit[tgt][3] += bonus;
                    self.monster_curse_credit.entry(e.hrid.to_string()).or_insert([[0.0;4];5])[tgt][3] += bonus;
                    if boss_wave {self.boss_wave_curse_credit[tgt][3] += bonus;}
                }
                e.d.hp -= ret;
            }
        }
        let mut ls = 0.0;
        if eff.is_none() && hit && e.s[LIFE_STEAL] > 0.0 {
            ls = e.add_hp((e.s[LIFE_STEAL] * dmg).floor());
        }
        let mut drain = 0.0;
        if let Some(i) = eff {
            if hit && i.hp_drain_ratio > 0.0 {
                let tt = 1.0 + e.s[HEALING_AMPLIFY];
                drain = e.add_hp((i.hp_drain_ratio * dmg * tt).ceil());
            }
        }
        let mut ml = 0.0;
        if eff.is_none() && hit && e.s[MANA_LEECH] > 0.0 {
            ml = e.add_mp((e.s[MANA_LEECH] * dmg).floor());
        }
        if self.observe_weapons {
            if e.is_player&&!t.is_player&&src<5{
                if hit{self.weapon_stats[src].curse_hit_count+=1.;self.weapon_stats[src].curse_hit_layers+=target_layers;if target_layers>=4.999{self.weapon_stats[src].curse_full_hits+=1.;}self.weapon_stats[src].fury_hit_count+=1.;self.weapon_stats[src].fury_hit_layers+=fury_layers;self.fury_damage_layers[src][fury_layers.clamp(0.,5.) as usize]+=dmg;}
                let baseline=fury_baseline.unwrap_or(dmg);self.weapon_stats[src].fury_baseline_damage+=baseline;
                self.weapon_stats[src].fury_bonus_damage+=dmg-baseline;
            }
            if !e.is_player&&t.is_player {
                for id in 0..self.players.len(){self.weapon_stats[id].team_taken+=dmg;}
                if let Some(no_weak)=unweakened {let prevented=(no_weak-dmg).max(0.);let owners=self.weaken_owners.get(&src).copied().unwrap_or([0.;5]);let total: f64=owners.iter().sum();if total>0. {for(id,share)in owners.iter().enumerate(){self.weapon_stats[id].weaken_prevented+=prevented*share/total;}}}
            }
        }
        Ok(AttackOut {
            is_crit,
            damage_done: dmg,
            curse_bonus,
            curse_snapshot_layers: target_layers,
            curse_owners: target_owners,
            did_hit: hit,
            thorn_damage: thorn,
            thorn_physical,
            retaliation_damage: ret,
            life_steal_heal: ls,
            hp_drain: drain,
            mana_leech: ml,
        })
    }

    fn check_encounter_end(&mut self) -> Result<bool, SimErr> {
        let _prof = crate::prof::start("check_encounter_end");
        if let Some(en) = self.enemies.clone() {
            for &s in en.iter() {
                let u = &mut self.units[s];
                if u.d.hp <= 0.0 && u.experience_rate == 0.0 {
                    let mut l = self.time - self.enrage_begin;
                    if l > u.enrage_time {
                        l = u.enrage_time;
                    }
                    u.experience_rate = 1.0 + l / u.enrage_time;
                }
            }
        }
        let mut e = false;
        let t = !self.players.iter().any(|&o| self.units[o].d.hp > 0.0);
        let is_dungeon = self.zone.as_ref().map(|z| z.is_dungeon).unwrap_or(false);
        let i = is_dungeon && t;
        if let Some(en) = self.enemies.clone() {
            if !en.iter().any(|&o| self.units[o].d.hp > 0.0) {
                self.q.clear_type(EvType::AutoAttack);
                if let Some(trial) = &mut self.trial {
                    if trial.complete(self.time) {
                        self.reset_trial_players();
                        self.q.add(self.time + ENEMY_RESPAWN, Ev::EnemyRespawn);
                    } else { self.q.clear(); }
                } else if !i {
                    self.q.add(self.time + ENEMY_RESPAWN, Ev::EnemyRespawn);
                }
                let mut o = 0.0;
                for &s in en.iter() {
                    o += self.units[s].experience * self.units[s].experience_rate;
                }
                let np = self.players.len() as f64;
                for pi in 0..self.players.len() {
                    let p = self.players[pi];
                    self.add_experience(p, o / np);
                }
                if !i && !self.trial.as_ref().map(|t| t.ended).unwrap_or(false) {
                    self.enemies = None;
                }
                if is_dungeon {
                    let k = self.zone.as_ref().unwrap().encounters_killed;
                    self.res
                        .update_time_spent_alive(&format!("#{}", js::num_key(k - 1.0)), false, self.time);
                    let max_waves = self
                        .zone
                        .as_ref()
                        .unwrap()
                        .dungeon
                        .as_ref()
                        .map(|d| d.max_waves)
                        .unwrap_or(f64::NAN);
                    if !i && k > max_waves {
                        self.res.update_dungeon_finish("#1", self.time);
                        self.res.last_dungeon_finish_time = self.time;
                        self.close_attempt(true);
                        self.zone.as_mut().unwrap().complete_dungeon();
                    }
                }
                self.res.encounters += 1.0;
                self.res.last_encounter_finish_time = self.time;
                e = true;
            }
        }
        for pi in 0..self.players.len() {
            let o = self.players[pi];
            if self.units[o].d.hp <= 0.0 {
                let h = self.units[o].hid;
                let has = self
                    .q
                    .any(|ev| matches!(ev, Ev::PlayerRespawn { hrid } if *hrid == h));
                if !has {
                    if let Some(z) = &self.zone {
                        if !z.is_dungeon {
                            self.q.add(
                                self.time + PLAYER_RESPAWN,
                                Ev::PlayerRespawn { hrid: h },
                            );
                        }
                    }
                    self.res.add_ran_out_of_mana(h, false, self.time);
                }
            }
        }
        let t = if self.trial.is_some() { !self.players.iter().any(|&o| self.units[o].d.hp > 0.0) } else { t };
        if t {
            if let Some(trial) = &mut self.trial {
                trial.fail(self.time); self.q.clear(); self.all_dead = true; return Ok(true);
            }
            if self.zone.is_some() {
                if is_dungeon {
                    let k = self.zone.as_ref().unwrap().encounters_killed;
                    if !self.omit_wipe_details { self.res.wipe_events.push(json!({"simulationTime":self.time,"wave":k-1.0,"logs":self.wipe_logs})); }
                    self.wipe_logs.clear();
                    self.close_attempt(false);
                    self.zone.as_mut().unwrap().fail_wave();
                    self.res.last_dungeon_finish_time = self.time;
                    for ty in [
                        EvType::AutoAttack,
                        EvType::CastEnd,
                        EvType::Dot,
                        EvType::ConsumableTick,
                        EvType::RegenTick,
                        EvType::EnrageTick,
                        EvType::StunExp,
                        EvType::BlindExp,
                        EvType::SilenceExp,
                        EvType::AwaitCooldown,
                    ] {
                        self.q.clear_type(ty);
                    }
                    self.enemies = None;
                    self.q.add(self.time + DUNGEON_RESTART, Ev::CombatStart);
                } else {
                    self.q.clear_type(EvType::AutoAttack);
                    self.q.clear_type(EvType::CastEnd);
                }
            }
            e = true;
            self.all_dead = true;
        }
        if let Some(lab) = &self.lab {
            if self.time - lab.encounter_start > 120.0 * 1e9 || e {
                self.enemies = None;
                e = true;
                self.q.clear();
                self.q.add(self.time, Ev::CombatStart);
            }
        }
        Ok(e)
    }

    fn reset_trial_players(&mut self) {
        for ty in [EvType::AutoAttack, EvType::CastEnd, EvType::AwaitCooldown, EvType::CooldownReady,
            EvType::Dot, EvType::CheckBuffExpiration, EvType::StunExp, EvType::BlindExp,
            EvType::SilenceExp, EvType::CurseExp, EvType::WeakenExp, EvType::FuryExp] { self.q.clear_type(ty); }
        for &id in self.players.iter() {
            let u = &mut self.units[id];
            self.res.add_ran_out_of_mana(u.hid, false, self.time);
            u.clear_buffs(); u.clear_ccs(); u.reset_cooldowns(self.time, &mut self.rng);
            u.d.hp = u.d.max_hp; u.d.mp = u.d.max_mp; u.out_of_mana = false;
        }
    }

    fn add_experience(&mut self, p: UnitId, t: f64) {
        let u = &self.units[p];
        if !u.is_player {
            return;
        }
        let i = match &u.kind {
            Kind::Player(ps) => ps.xp_weights,
            _ => return,
        };
        let ce = u.s[COMBAT_EXPERIENCE];
        let dl = u.debuff_on_level_gap;
        let skill_xp = [
            u.s[STAMINA_EXPERIENCE],
            u.s[INTELLIGENCE_EXPERIENCE],
            u.s[ATTACK_EXPERIENCE],
            u.s[MELEE_EXPERIENCE],
            u.s[DEFENSE_EXPERIENCE],
            u.s[RANGED_EXPERIENCE],
            u.s[MAGIC_EXPERIENCE],
        ];
        let h = u.hid;
        let entry = self.res.experience_gained.entry(h).or_insert([0.0; 7]);
        for k in 0..7 {
            let c = i[k];
            if c <= 0.0 {
                continue;
            }
            let uu = c * (1.0 + skill_xp[k]);
            entry[k] += t * (1.0 + ce) * uu * (1.0 + dl);
        }
    }

    fn add_next_attack(&mut self, e: UnitId) -> Result<(), SimErr> {
        if !self.current_combatant(e) { return Ok(()); }
        let _prof = crate::prof::start("add_next_attack");
        if self.q.any(|ev| match ev {
            Ev::CastEnd { source, .. } | Ev::AutoAttack { source } => *source == e,
            _ => false,
        }) {
            return Ok(());
        }
        let is_player = self.units[e].is_player;
        let (i, a): (Option<Rc<[UnitId]>>, Option<Rc<[UnitId]>>) = if is_player {
            (Some(self.players.clone()), self.enemies.clone())
        } else {
            (self.enemies.clone(), Some(self.players.clone()))
        };
        let t = self.get_target(a.as_deref());
        let mut n = false;
        let mut o = false;
        let mut slots: Vec<usize> = (0..self.units[e].abilities.len()).collect();
        slots.sort_by_key(|&slot| self.units[e].abilities[slot].as_ref().is_some_and(|a|
            matches!(a.def.hrid.as_ref(), "/abilities/water_strike" | "/abilities/fireball" | "/abilities/entangle")));
        for slot in slots {
            if self.units[e].abilities[slot].is_none() {
                continue;
            }
            if n || o {
                continue;
            }
            if !self.ability_should_trigger(e, slot, t, i.as_deref(), a.as_deref())? {
                continue;
            }
            let mana = self.units[e].abilities[slot].as_ref().unwrap().def.mana_cost;
            if !self.can_use_ability(e, mana, true) {
                o = true;
            }
            if !o {
                let u = &self.units[e];
                let mut l = u.abilities[slot].as_ref().unwrap().def.cast;
                l /= 1.0 + u.s[CAST_SPEED];
                self.q.add(self.time + l, Ev::CastEnd { source: e, slot });
                n = true;
            }
        }
        if n {
            self.units[e].out_of_mana = false;
            return Ok(());
        }
        if a.is_some() {
            if self.units[e].blinded {
                self.units[e].out_of_mana = true;
            } else {
                let ai = self.units[e].s[ATTACK_INTERVAL];
                self.q.add(self.time + ai, Ev::AutoAttack { source: e });
            }
        }
        Ok(())
    }

    fn on_consumable_tick(&mut self, source: UnitId, drink: bool, slot: usize, total: f64, current: f64) {
        let (hp_r, mp_r, hrid) = {
            let c = self.consumable(source, drink, slot);
            (c.hp_restore, c.mp_restore, c.hid)
        };
        let sh = self.units[source].hid;
        if hp_r > 0.0 {
            let t = calc_tick(hp_r, total, current);
            let i = self.units[source].add_hp(t);
            self.res.add_hp_gained(sh, hrid, i);
        }
        if mp_r > 0.0 {
            let t = calc_tick(mp_r, total, current);
            let i = self.units[source].add_mp(t);
            self.res.add_mp_gained(sh, hrid, i);
            if self.units[source].out_of_mana {
                self.q.add(self.time, Ev::AwaitCooldown { source });
            }
        }
        if current < total {
            self.q.add(
                self.time + CONSUMABLE_TICK,
                Ev::ConsumableTick {
                    source,
                    drink,
                    slot,
                    total,
                    current: current + 1.0,
                },
            );
        }
    }

    fn consumable(&self, u: UnitId, drink: bool, slot: usize) -> &Consumable {
        let list = if drink {
            &self.units[u].drinks
        } else {
            &self.units[u].food
        };
        list[slot].as_ref().unwrap()
    }

    fn consumable_mut(&mut self, u: UnitId, drink: bool, slot: usize) -> &mut Consumable {
        let list = if drink {
            &mut self.units[u].drinks
        } else {
            &mut self.units[u].food
        };
        list[slot].as_mut().unwrap()
    }

    fn on_dot(&mut self, source_ref: UnitId, target: UnitId, damage: f64, total: f64, current: f64, curse_bonus: f64, curse_layers: f64, curse_owners: [f64;5]) -> Result<(), SimErr> {
        let phase=self.phase_name();
        let t = calc_tick(damage, total, current);
        let i = js::min(t, self.units[target].d.hp);
        if self.units[source_ref].is_player && !self.units[target].is_player && i > 0.0 {
            self.phase_damage.entry(phase.clone()).or_insert([0.0;5])[source_ref] += i;
            let live = self.live_curse_layers(target);
            record_layer_stats(&mut self.curse_layer_stats[source_ref][1],live,curse_layers,i);
            record_layer_stats(&mut self.monster_layer_stats.entry(self.units[target].hrid.to_string()).or_insert([[[0.0;6];4];5])[source_ref][1],live,curse_layers,i);
            let boss_wave = self.enemies.as_ref().is_some_and(|ids| ids.iter().any(|id| self.gd.monsters.get(self.units[*id].hrid.as_ref()).is_some_and(|m|m["isBoss"]==true)));
            if boss_wave {record_layer_stats(&mut self.boss_wave_layer_stats[source_ref][1],live,curse_layers,i);}
        }
        if self.units[source_ref].is_player && !self.units[target].is_player && curse_bonus > 0.0 {
            let no_curse_tick = calc_tick(damage-curse_bonus,total,current);
            let bonus = (i-js::min(no_curse_tick,self.units[target].d.hp)).max(0.0);
            allocate(&mut self.transfers, source_ref, bonus, curse_owners);
                allocate(self.phase_transfers.entry(phase.clone()).or_insert([[0.0;5];5]), source_ref, bonus, curse_owners);
            self.curse_credit[source_ref][1] += bonus;
            self.monster_curse_credit.entry(self.units[target].hrid.to_string()).or_insert([[0.0;4];5])[source_ref][1] += bonus;
            let boss_wave = self.enemies.as_ref().is_some_and(|ids| ids.iter().any(|id| self.gd.monsters.get(self.units[*id].hrid.as_ref()).is_some_and(|m|m["isBoss"]==true)));
            if boss_wave {self.boss_wave_curse_credit[source_ref][1] += bonus;}
        }
        self.units[target].d.hp -= i;
        let (sh, th) = (self.units[source_ref].hid, self.units[target].hid);
        let dn = self.s_dot;
        self.res.add_attack(sh, th, dn, Some(i));
        self.log_damage(None, "damageOverTime", target, i, false);
        if current < total {
            self.q.add(
                self.time + DOT_TICK,
                Ev::Dot {
                    source_ref,
                    target,
                    damage,
                    total,
                    current: current + 1.0,
                    curse_bonus,
                    curse_layers, curse_owners,
                },
            );
        }
        if self.units[target].d.hp == 0.0 {
            self.kill(target);
        }
        self.check_encounter_end()?;
        Ok(())
    }

    fn on_regen(&mut self) {
        for pi in 0..self.players.len() {
            let a = self.players[pi];
            if self.units[a].d.hp <= 0.0 {
                continue;
            }
            let h = self.units[a].hid;
            let n = (self.units[a].d.max_hp * self.units[a].s[HP_REGEN]).floor();
            let o = self.units[a].add_hp(n);
            let rn = self.s_regen;
            self.res.add_hp_gained(h, rn, o);
            let s = (self.units[a].d.max_mp * self.units[a].s[MP_REGEN]).floor();
            let l = self.units[a].add_mp(s);
            self.res.add_mp_gained(h, rn, l);
            if self.units[a].out_of_mana {
                self.q.add(self.time, Ev::AwaitCooldown { source: a });
            }
        }
        self.q.add(self.time + REGEN_TICK, Ev::RegenTick);
    }

    /// `applyCappedStackingDebuff` for curse (true) or weaken (false).
    fn apply_capped_debuff(&mut self, e: UnitId, t: f64, curse: bool, owner: UnitId) {
        let prev = self.q.find(|ev| match ev {
            Ev::CurseExp { source, .. } if curse => *source == e,
            Ev::WeakenExp { source, .. } if !curse => *source == e,
            _ => false,
        });
        let prev_amount = match prev {
            Some(Ev::CurseExp { amount, .. }) | Some(Ev::WeakenExp { amount, .. }) => *amount,
            _ => 0.0,
        };
        let u = js::or0(prev_amount);
        self.q.clear_matching(|ev| match ev {
            Ev::CurseExp { source, .. } if curse => *source == e,
            Ev::WeakenExp { source, .. } if !curse => *source == e,
            _ => false,
        });
        let n = js::max(0.0, js::or0(u));
        let o = js::max(0.0, js::or0(t));
        let amount = js::max(n, js::min(n + o, o * 5.0));
        if owner<self.players.len(){if curse{self.weapon_stats[owner].curse_applications+=1.0;self.weapon_stats[owner].curse_new_strength+=(amount-n).max(0.0);}else{self.weapon_stats[owner].weaken_applications+=1.0;if amount<=n{self.weapon_stats[owner].weaken_refreshes+=1.0;}}}
        if curse {
            let shares = self.owners.entry(e).or_insert([0.0;5]);
            if n == 0.0 { *shares=[0.0;5]; }
            if owner < 5 { shares[owner] += (amount-n).max(0.0); }
        }
        if !curse {let shares=self.weaken_owners.entry(e).or_insert([0.;5]);if n==0.{*shares=[0.;5];}if owner<5{shares[owner]+=(amount-n).max(0.);}}
        let (unique, typ, ratio, flat) = if curse {
            (self.u_curse, bt::DAMAGE_TAKEN, 0.0, amount)
        } else {
            (self.u_weaken, bt::DAMAGE, -1.0 * amount, 0.0)
        };
        let h = BuffTemplate {
            source_level: 0.0,
            unique,
            typ,
            ratio,
            flat,
            duration: 15e9,
            has_multiplier_skill: false,
            multiplier_skill: None,
            multiplier_per_level: 0.0,
        };
        if self.trial.is_some() { self.units[e].add_buff(&h, self.time); }
        else { self.units[e].replace_buff(&h, self.time); }
        let ev = if curse {
            Ev::CurseExp { amount, source: e }
        } else {
            Ev::WeakenExp { amount, source: e }
        };
        self.q.add(self.time + 15e9, ev);
    }

    fn fury(&mut self, e: UnitId, did_hit: bool, batch: bool) {
        if e<self.players.len(){self.weapon_stats[e].fury_events+=1.0;}
        let batch = batch || self.trial.is_some();
        let prev = self.q.find(|ev| matches!(ev, Ev::FuryExp { source, .. } if *source == e));
        let mut f = match prev {
            Some(Ev::FuryExp { amount, .. }) => *amount,
            _ => 0.0,
        };
        self.q
            .clear_matching(|ev| matches!(ev, Ev::FuryExp { source, .. } if *source == e));
        if did_hit {
            f = js::min(f + 1.0, 5.0);
        } else {
            f = f / 2.0;
        }
        let rb = f * self.units[e].s[FURY];
        let k = BuffTemplate {
            source_level: 0.0,
            unique: self.u_fury_acc,
            typ: bt::FURY_ACCURACY,
            ratio: rb,
            flat: 0.0,
            duration: 15e9,
            has_multiplier_skill: false,
            multiplier_skill: None,
            multiplier_per_level: 0.0,
        };
        let mut ed = k.clone();
        ed.unique = self.u_fury_dmg;
        ed.typ = bt::FURY_DAMAGE;
        if f > 0.0 {
            self.q.add(self.time + 15e9, Ev::FuryExp { amount: f, source: e });
            if batch {
                self.units[e].add_buffs(&[k, ed], self.time);
            } else {
                self.units[e].add_buff(&k, self.time);
                self.units[e].add_buff(&ed, self.time);
            }
        } else if batch {
            self.units[e].remove_buffs(&[k.unique, ed.unique]);
        } else {
            self.units[e].remove_buffs(&[k.unique]);
            self.units[e].remove_buffs(&[ed.unique]);
        }
    }

    fn on_enrage(&mut self, encounter_time: f64) {
        let en = match self.enemies.clone() {
            Some(e) => e,
            None => return,
        };
        let alive: Units = en.iter().copied().filter(|&a| self.units[a].d.hp > 0.0).collect();
        for a in alive {
            let n = js::min(10.0, (encounter_time / self.units[a].enrage_time).floor());
            if n <= 0.0 {
                continue;
            }
            let o = BuffTemplate {
                source_level: 0.0,
                unique: self.u_enrage_dmg,
                typ: bt::DAMAGE,
                ratio: n * 0.1,
                flat: 0.0,
                duration: ENRAGE_TICK,
                has_multiplier_skill: false,
                multiplier_skill: None,
                multiplier_per_level: 0.0,
            };
            let mut s = o.clone();
            s.unique = self.u_enrage_acc;
            s.typ = bt::ACCURACY;
            self.units[a].add_buffs(&[o, s], self.time);
            self.res.max_enrage_stack = js::max(self.res.max_enrage_stack, n);
        }
        self.q.add(
            self.time + ENRAGE_TICK,
            Ev::EnrageTick {
                encounter_time: encounter_time + ENRAGE_TICK,
            },
        );
    }

    // ------------------------------------------------------------------ triggers

    fn check_triggers(&mut self) -> Result<(), SimErr> {
        let _prof = crate::prof::start("check_triggers");
        let mut rounds = 0u32;
        loop {
            rounds += 1;
            if rounds > 100_000 {
                // e.g. a consumable with cooldown 0: the original engine never returns here
                return Err("consumable trigger loop does not terminate".into());
            }
            let mut e = false;
            let players = self.players.clone();
            let alive_p: Units = players
                .iter()
                .copied()
                .filter(|&t| self.units[t].d.hp > 0.0)
                .collect();
            for t in alive_p {
                let en = self.enemies.clone();
                if self.check_triggers_for_unit(t, &players, en.as_deref())? {
                    e = true;
                }
            }
            if let Some(en) = self.enemies.clone() {
                let alive_e: Units = en
                    .iter()
                    .copied()
                    .filter(|&t| self.units[t].d.hp > 0.0)
                    .collect();
                for t in alive_e {
                    let en2 = self.enemies.clone().unwrap_or_default();
                    if self.check_triggers_for_unit(t, &en2, Some(&players))? {
                        e = true;
                    }
                }
            }
            if !e {
                return Ok(());
            }
        }
    }

    fn check_triggers_for_unit(
        &mut self,
        e: UnitId,
        allies: &[UnitId],
        opps: Option<&[UnitId]>,
    ) -> Result<bool, SimErr> {
        if self.units[e].d.hp <= 0.0 {
            return Err("Checking triggers for a dead unit".into());
        }
        let mut a = false;
        let n = self.get_target(opps);
        for drink in [false, true] {
            let len = if drink {
                self.units[e].drinks.len()
            } else {
                self.units[e].food.len()
            };
            for slot in 0..len {
                let present = if drink {
                    self.units[e].drinks[slot].is_some()
                } else {
                    self.units[e].food[slot].is_some()
                };
                if !present {
                    continue;
                }
                if self.consumable_should_trigger(e, drink, slot, n, allies, opps)?
                    && self.try_use_consumable(e, drink, slot)
                {
                    a = true;
                }
            }
        }
        Ok(a)
    }

    fn consumable_should_trigger(
        &self,
        unit: UnitId,
        drink: bool,
        slot: usize,
        target: Option<UnitId>,
        allies: &[UnitId],
        opps: Option<&[UnitId]>,
    ) -> Result<bool, SimErr> {
        let u = &self.units[unit];
        if u.stunned {
            return Ok(false);
        }
        let c = self.consumable(unit, drink, slot);
        let o = if c.is_food {
            u.s[FOOD_HASTE]
        } else {
            u.s[DRINK_CONCENTRATION]
        };
        let mut s = c.cooldown;
        if o > 0.0 {
            s = s / (1.0 + o);
        }
        if c.last_used + s > self.time {
            return Ok(false);
        }
        if c.triggers.is_empty() {
            return Ok(true);
        }
        let mut l = true;
        for tr in &c.triggers {
            if !self.trigger_active(tr, unit, target, Some(allies), opps, None)? {
                l = false;
            }
        }
        Ok(l)
    }

    fn ability_should_trigger(
        &self,
        unit: UnitId,
        slot: usize,
        target: Option<UnitId>,
        allies: Option<&[UnitId]>,
        opps: Option<&[UnitId]>,
    ) -> Result<bool, SimErr> {
        let u = &self.units[unit];
        if u.stunned || u.silenced {
            return Ok(false);
        }
        let ab = u.abilities[slot].as_ref().unwrap();
        let o = u.s[ABILITY_HASTE];
        let mut s = ab.def.cooldown;
        if o > 0.0 {
            s = (s * 100.0) / (100.0 + o);
        }
        if ab.last_used + s > self.time {
            return Ok(false);
        }
        if ab.triggers.is_empty() {
            return Ok(true);
        }
        let mut l = true;
        for tr in ab.triggers.iter() {
            if !self.trigger_active(tr, unit, target, allies, opps, Some(&ab.def))? {
                l = false;
            }
        }
        Ok(l)
    }

    fn trigger_active(
        &self,
        tr: &Trigger,
        unit: UnitId,
        target: Option<UnitId>,
        allies: Option<&[UnitId]>,
        opps: Option<&[UnitId]>,
        casting: Option<&AbilityDef>,
    ) -> Result<bool, SimErr> {
        if tr.single_target {
            let v = match tr.dep {
                Dep::SelfDep => self.dep_value(tr, unit, casting)?,
                Dep::TargetedEnemy => match target {
                    None => return Ok(false),
                    Some(t) => self.dep_value(tr, t, casting)?,
                },
                _ => return Err("Unknown dependencyHrid in trigger".into()),
            };
            return compare(tr, v);
        }
        let list: &[UnitId] = match tr.dep {
            Dep::AllAllies => allies.ok_or("allies list missing")?,
            Dep::AllEnemies => match opps {
                None => return Ok(false),
                Some(o) => o,
            },
            _ => return Err("Unknown dependencyHrid in trigger".into()),
        };
        let v = match tr.cond {
            Cond::NumberOfActiveUnits => {
                Val::Num(list.iter().filter(|&&o| self.units[o].d.hp > 0.0).count() as f64)
            }
            Cond::NumberOfDeadUnits => {
                Val::Num(list.iter().filter(|&&o| self.units[o].d.hp <= 0.0).count() as f64)
            }
            Cond::LowestHpPercentage => {
                let mut m = 2.0;
                for &o in list {
                    let u = &self.units[o];
                    if u.d.hp > 0.0 {
                        let l = u.d.hp / u.d.max_hp;
                        if l < m {
                            m = l;
                        }
                    }
                }
                Val::Num(m * 100.0)
            }
            _ => {
                let mut acc = Val::Num(0.0);
                for &o in list {
                    if self.units[o].d.hp <= 0.0 {
                        continue;
                    }
                    let v = self.dep_value(tr, o, casting)?;
                    acc = match (acc, v) {
                        (Val::Str, _) => Val::Str,
                        (Val::Num(a), Val::Num(b)) => Val::Num(a + b),
                        (Val::Num(a), Val::Bool(b)) => Val::Num(a + if b { 1.0 } else { 0.0 }),
                        (Val::Num(_), Val::Obj(true)) => Val::Str,
                        (Val::Num(_), Val::Obj(false)) => Val::Num(f64::NAN),
                        (Val::Num(_), Val::Str) => Val::Str,
                        (a, _) => a,
                    };
                }
                acc
            }
        };
        compare(tr, v)
    }

    fn dep_value(&self, tr: &Trigger, u: UnitId, casting: Option<&AbilityDef>) -> Result<Val, SimErr> {
        let unit = &self.units[u];
        let present = |b: &Buff| {
            if !b.permanent && b.start + b.duration <= self.time { return false; }
            let replaceable = tr.cmp == Cmp::IsInactive && casting.is_some_and(|a|
                a.level > b.source_level && a.effects.iter().any(|e|
                    e.buffs.as_ref().is_some_and(|bs| bs.iter().any(|x| x.unique == b.unique))));
            !replaceable
        };
        Ok(match &tr.cond {
            Cond::BuffExact(id) => Val::Obj(unit.combat_buffs.get(id).is_some_and(&present)),
            Cond::BuffPrefix(k) => {
                let bit = 1u32 << *k;
                Val::Obj(
                    unit.combat_buffs
                        .values()
                        .any(|b| self.it.prefix_mask[b.unique as usize] & bit != 0 && present(b)),
                )
            }
            Cond::BossStatus => Val::Bool(self.gd.monsters.get(unit.hrid.as_ref()).is_some_and(|m| m["isBoss"] == true)),
            Cond::CurrentHp => Val::Num(unit.d.hp),
            Cond::CurrentMp => Val::Num(unit.d.mp),
            Cond::MissingHp => Val::Num(unit.d.max_hp - unit.d.hp),
            Cond::MissingMp => Val::Num(unit.d.max_mp - unit.d.mp),
            Cond::StunStatus => Val::Bool(unit.stunned && unit.stun_expire.is_some_and(|t| t > self.time)),
            Cond::BlindStatus => Val::Bool(unit.blinded && unit.blind_expire.is_some_and(|t| t > self.time)),
            Cond::SilenceStatus => {
                Val::Bool(unit.silenced && unit.silence_expire.is_some_and(|t| t > self.time))
            }
            _ => return Err("Unknown conditionHrid in trigger".into()),
        })
    }

    // ------------------------------------------------------------------ consumables

    fn try_use_consumable(&mut self, e: UnitId, drink: bool, slot: usize) -> bool {
        let _prof = crate::prof::start("try_use_consumable");
        if self.units[e].d.hp <= 0.0 {
            return false;
        }
        let time = self.time;
        let dc = self.units[e].s[DRINK_CONCENTRATION];
        let fh = self.units[e].s[FOOD_HASTE];
        let (mut i, is_drink, is_food, recovery, hp_r, mp_r, hrid, buffs) = {
            let c = self.consumable_mut(e, drink, slot);
            c.last_used = time;
            (
                c.cooldown,
                c.is_drink,
                c.is_food,
                c.recovery,
                c.hp_restore,
                c.mp_restore,
                c.hid,
                c.buffs.clone(),
            )
        };
        if dc > 0.0 && is_drink {
            i = i / (1.0 + dc);
        } else if fh > 0.0 && is_food {
            i = i / (1.0 + fh);
        }
        self.q.add(time + i, Ev::CooldownReady);
        let eh = self.units[e].hid;
        self.res.add_consumable_use(eh, hrid);
        if recovery == 0.0 {
            if hp_r > 0.0 {
                let n = self.units[e].add_hp(hp_r);
                self.res.add_hp_gained(eh, hrid, n);
            }
            if mp_r > 0.0 {
                let n = self.units[e].add_mp(mp_r);
                self.res.add_mp_gained(eh, hrid, n);
                if self.units[e].out_of_mana {
                    self.q.add(time, Ev::AwaitCooldown { source: e });
                }
            }
        } else {
            self.q.add(
                time + CONSUMABLE_TICK,
                Ev::ConsumableTick {
                    source: e,
                    drink,
                    slot,
                    total: recovery / CONSUMABLE_TICK,
                    current: 1.0,
                },
            );
        }
        for n in buffs {
            let mut o = n.clone();
            let dc = self.units[e].s[DRINK_CONCENTRATION];
            if dc > 0.0 && is_drink {
                o.ratio *= 1.0 + dc;
                o.flat *= 1.0 + dc;
                o.duration = o.duration / (1.0 + dc);
            }
            self.units[e].add_buff(&o, time);
            self.q
                .add(time + o.duration, Ev::CheckBuffExpiration { source: e });
        }
        true
    }

    // ------------------------------------------------------------------ abilities

    fn can_use_ability(&mut self, e: UnitId, mana_cost: f64, record: bool) -> bool {
        let u = &self.units[e];
        if u.d.hp <= 0.0 {
            return false;
        }
        let is_player = u.is_player;
        let h = u.hid;
        if u.d.mp < mana_cost {
            if is_player && record {
                self.res.add_ran_out_of_mana(h, true, self.time);
            }
            false
        } else {
            if is_player && record {
                self.res.add_ran_out_of_mana(h, false, self.time);
            }
            true
        }
    }

    fn try_use_ability(&mut self, e0: UnitId, slot: usize) -> Result<bool, SimErr> {
        if !self.current_combatant(e0) { return Ok(false); }
        let _prof = crate::prof::start("try_use_ability");
        let def = match self.units[e0].abilities.get(slot).and_then(|a| a.as_ref()) {
            Some(a) => a.def.clone(),
            None => return Err("cast of missing ability".into()),
        };
        if !self.can_use_ability(e0, def.mana_cost, true) {
            return Ok(false);
        }
        let mut e = e0;
        {
            let u = &mut self.units[e];
            if u.is_player {
                *u.mana_costs.entry(def.hid).or_insert(0.0) += def.mana_cost;
            }
            u.d.mp -= def.mana_cost;
            u.abilities[slot].as_mut().unwrap().last_used = self.time;
        }
        if self.observe_weapons&&e<self.players.len(){let haste=self.units[e].s[ABILITY_HASTE];let original=if haste>0.{def.cooldown*100./(100.+haste)}else{def.cooldown};self.cooldown_cycles.insert((e,def.hid),CooldownCycle{started:self.time,last_used:self.time,shift:0.,original,phase:self.phase_name()});}
        let mut list: SmallVec<[Rc<AbilityDef>; 3]> = SmallVec::new();
        list.push(def.clone());
        if self.units[e].s[BLAZE] > 0.0 && self.rng.next() < self.units[e].s[BLAZE] {
            if e<self.players.len(){self.weapon_stats[e].blaze_triggers+=1.0;}
            if self.blaze_def.is_none() {
                self.blaze_def = Some(self.ability_def("blaze", 1.0)?);
            }
            list.push(self.blaze_def.clone().unwrap());
        }
        if self.units[e].s[BLOOM] > 0.0 && self.rng.next() < self.units[e].s[BLOOM] {
            if e<self.players.len(){self.weapon_stats[e].bloom_triggers+=1.0;}
            if self.bloom_def.is_none() {
                self.bloom_def = Some(self.ability_def("bloom", 1.0)?);
            }
            list.push(self.bloom_def.clone().unwrap());
        }
        for a in &list {
            for idx in 0..a.effects.len() {
                let eff = &a.effects[idx];
                match eff.kind {
                    EffectKind::Buff => self.ability_buff(e, a, eff)?,
                    EffectKind::Damage => self.ability_damage(e, a, eff)?,
                    EffectKind::Heal => self.ability_heal(e, a, eff)?,
                    EffectKind::SpendHp => self.ability_spend_hp(e, a, eff)?,
                    EffectKind::Revive => self.ability_revive(e, a, eff)?,
                    EffectKind::Promote => {
                        e = self.promote(e)?;
                    }
                    EffectKind::Other => {
                        return Err(format!("Unsupported effect type for ability: {}", a.hrid))
                    }
                }
            }
        }
        if self.units[e].s[RIPPLE] > 0.0 && self.rng.next() < self.units[e].s[RIPPLE] {
            let a = self.units[e].add_mp(10.0);
            if e<self.players.len(){self.weapon_stats[e].ripple_triggers+=1.0;self.weapon_stats[e].ripple_mana+=a;}
            let h = self.units[e].hid;
            let rn = self.s_ripple;
            self.res.add_mp_gained(h, rn, a);
            let time = self.time;
            let haste=self.units[e].s[ABILITY_HASTE];
            for ab in self.units[e].abilities.iter_mut().flatten() {
                if js::truthy(ab.last_used) && ab.last_used + ab.def.cooldown - time > 0.0 {
                    let old=ab.last_used;
                    let effective=if haste>0.{ab.def.cooldown*100./(100.+haste)}else{ab.def.cooldown};
                    ab.last_used = js::max(ab.last_used - X * 2.0, time - ab.def.cooldown);
                    if e<self.players.len(){self.weapon_stats[e].ripple_cooldown_seconds+=(old-ab.last_used)/1e9;
                        if self.observe_weapons{let actual=(old+effective-time).max(0.).min((old-ab.last_used).max(0.));if let Some(cycle)=self.cooldown_cycles.get_mut(&(e,ab.def.hid)){cycle.shift+=actual;cycle.last_used=ab.last_used;}}
                    }
                }
            }
        }
        self.add_next_attack(e)?;
        if self.units[e].d.hp == 0.0 {
            self.kill(e);
        }
        self.check_encounter_end()?;
        Ok(true)
    }

    fn promote(&mut self, old: UnitId) -> Result<UnitId, SimErr> {
        let enemies = self.enemies.as_ref().ok_or("promotion without enemies")?;
        let pos = enemies.iter().position(|&id| id == old).ok_or("promoted unit is not an enemy")?;
        let mut ids = enemies.to_vec();
        let ratio = self.units[old].d.hp / self.units[old].d.max_hp;
        let tier = self.units[old].difficulty_tier;
        let room_level = match &self.units[old].kind {
            Kind::Monster { room_level, .. } => *room_level,
            _ => return Err("only monsters can promote".into()),
        };
        let names = ["/monsters/enchanted_rook", "/monsters/enchanted_knight", "/monsters/enchanted_bishop"];
        let n = (self.rng.next() * 3.0).floor() as usize;
        let new = self.spawn_monster(names[n], tier, room_level)?;
        self.units[new].reset(self.time, &mut self.rng);
        self.units[new].d.hp = (self.units[new].d.max_hp * ratio).clamp(0.0, self.units[new].d.max_hp);
        self.q.clear_for_unit(old);
        self.owners.remove(&old);
        self.weaken_owners.remove(&old);
        self.res.update_time_spent_alive(self.it.name(self.units[old].hid), false, self.time);
        self.units[old].d.hp = 0.0;
        ids[pos] = new;
        self.enemies = Some(Rc::from(ids));
        self.res.update_time_spent_alive(self.it.name(self.units[new].hid), true, self.time);
        Ok(new)
    }

    fn ability_buff(&mut self, e: UnitId, t: &AbilityDef, i: &Effect) -> Result<(), SimErr> {
        let buffs = i.buffs.as_ref().ok_or("buff effect without buffs")?;
        if i.target == Target::AllAllies {
            let a = self.allies(e).ok_or("allies list missing")?;
            let alive: Units = a.iter().copied().filter(|&o| self.units[o].d.hp > 0.0).collect();
            for n in alive {
                for o in buffs {
                    if t.is_special && o.has_multiplier_skill && o.multiplier_per_level > 0.0 {
                        let lvl = match o.multiplier_skill {
                            Some(k) => self.units[e].d.level[k],
                            None => f64::NAN,
                        };
                        let l = 1.0 + lvl * o.multiplier_per_level;
                        let mut c = o.clone();
                        c.flat *= l;
                        c.ratio *= l;
                        self.units[n].add_buff(&c, self.time);
                    } else {
                        self.units[n].add_buff(o, self.time);
                    }
                    self.q
                        .add(self.time + o.duration, Ev::CheckBuffExpiration { source: n });
                }
            }
            return Ok(());
        }
        if i.target != Target::SelfT {
            return Err(format!("Unsupported target type for buff ability effect: {}", t.hrid));
        }
        for a in buffs {
            self.units[e].add_buff(a, self.time);
            self.q
                .add(self.time + a.duration, Ev::CheckBuffExpiration { source: e });
        }
        Ok(())
    }

    fn ability_damage(&mut self, e: UnitId, t: &AbilityDef, i: &Effect) -> Result<(), SimErr> {
        let _prof = crate::prof::start("ability_damage");
        match i.target {
            Target::Enemy | Target::AllEnemies => {}
            _ => {
                return Err(format!(
                    "Unsupported target type for damage ability effect: {}",
                    t.hrid
                ))
            }
        }
        let mut a: Units = match self.opponents(e) {
            Some(a) => a.iter().copied().collect(),
            None => return Ok(()),
        };
        let mut picked: SmallVec<[u32; 8]> = SmallVec::new();
        let mut parry_checked = false;
        let snapshot: Units = a.iter().copied().filter(|&x| self.units[x].d.hp > 0.0).collect();
        let e_is_player = self.units[e].is_player;
        for mut u in snapshot {
            let mut par = None;
            if !parry_checked {
                par = self.check_parry(&a);
                parry_checked = true;
            }
            if let Some(p) = par {
                if self.observe_weapons&&!e_is_player&&p<5{let targets:Vec<_>=if i.target==Target::AllEnemies{a.iter().copied().filter(|id|self.units[*id].d.hp>0.).collect()}else{vec![u]};let mut rng=self.rng.clone();for target in targets{self.weapon_stats[p].parry_prevented+=probe_direct_damage_rng(&self.units[e],&self.units[target],Some(i),&mut rng);if target<5{self.parry_targets[p][target]+=1.;}}}
                let g = e;
                let h = self.process_attack(p, g, None)?;
                if p<self.players.len()&&!self.units[g].is_player{self.weapon_stats[p].parries+=1.0;self.weapon_stats[p].parry_damage+=h.damage_done;}
                let (ph, gh) = (self.units[p].hid, self.units[g].hid);
                let pn = self.s_parry;
                self.res
                    .add_attack(ph, gh, pn, if h.did_hit { Some(h.damage_done) } else { None });
                if h.life_steal_heal > 0.0 {
                    let n = self.s_lifesteal;
                    self.res.add_hp_gained(ph, n, h.life_steal_heal);
                }
                if h.mana_leech > 0.0 {
                    let n = self.s_mana_leech;
                    self.res.add_mp_gained(ph, n, h.mana_leech);
                }
                if h.thorn_damage > 0.0 {
                    let tn = self.thorn_name(h.thorn_physical);
                    self.res.add_attack(gh, ph, tn, Some(h.thorn_damage));
                }
                if self.units[g].s[RETALIATION] > 0.0 {
                    let rn = self.s_retaliation;
                    self.res.add_attack(
                        gh,
                        ph,
                        rn,
                        if h.retaliation_damage > 0.0 { Some(h.retaliation_damage) } else { None },
                    );
                }
                if self.units[g].d.hp == 0.0 {
                    self.kill(g);
                }
                if self.units[p].d.hp == 0.0 && (h.thorn_damage != 0.0 || h.retaliation_damage != 0.0) {
                    self.kill(p);
                }
            } else {
                a = a
                    .into_iter()
                    .filter(|&p| {
                        let pu = &self.units[p];
                        !picked.iter().any(|x| *x == pu.hid) && pu.d.hp > 0.0
                    })
                    .collect();
                if !e_is_player && !a.is_empty() && i.target == Target::Enemy {
                    u = self.pick_by_threat(&a)?;
                    picked.push(self.units[u].hid);
                }
                if a.is_empty() {
                    break;
                }
                let g = self.process_attack_kind(e, u, Some(i), t.hrid.as_ref() != "blaze")?;
                if e<self.players.len()&&!self.units[u].is_player&&t.hrid.as_ref()=="blaze"{self.weapon_stats[e].blaze_damage+=g.damage_done;}
                if g.did_hit && g.damage_done > 0.0 { self.log_damage(Some(e), &t.hrid, u, g.damage_done, g.is_crit); }
                let (eh, uh) = (self.units[e].hid, self.units[u].hid);
                if g.hp_drain > 0.0 {
                    self.res.add_hp_gained(eh, t.hid, g.hp_drain);
                }
                if g.did_hit {
                    if let Some(bs) = &i.buffs {
                        for p in bs {
                            self.units[u].add_buff(p, self.time);
                            self.q
                                .add(self.time + p.duration, Ev::CheckBuffExpiration { source: u });
                        }
                    }
                }
                if i.dot_ratio > 0.0 && g.damage_done > 0.0 {
                    self.q.add(
                        self.time + DOT_TICK,
                        Ev::Dot {
                            source_ref: e,
                            target: u,
                            damage: g.damage_done * i.dot_ratio,
                            curse_bonus: g.curse_bonus * i.dot_ratio,
                            curse_layers: g.curse_snapshot_layers,
                            curse_owners: g.curse_owners,
                            total: i.dot_duration / DOT_TICK,
                            current: 1.0,
                        },
                    );
                }
                if g.did_hit
                    && i.stun_chance > 0.0
                    && self.rng.next()
                        < (i.stun_chance * 100.0) / (100.0 + self.units[u].s[TENACITY])
                {
                    let exp = (self.time + i.stun_duration).max(self.units[u].stun_expire.unwrap_or(0.0));
                    self.units[u].stunned = true;
                    self.units[u].stun_expire = Some(exp);
                    self.q.clear_matching(|h| {
                        matches!(h, Ev::AutoAttack { source } | Ev::CastEnd { source, .. } | Ev::StunExp { source } if *source == u)
                    });
                    self.q.add(exp, Ev::StunExp { source: u });
                }
                if g.did_hit
                    && i.blind_chance > 0.0
                    && self.rng.next()
                        < (i.blind_chance * 100.0) / (100.0 + self.units[u].s[TENACITY])
                {
                    let exp = self.time + i.blind_duration;
                    self.units[u].blinded = true;
                    self.units[u].blind_expire = Some(exp);
                    self.q
                        .clear_matching(|h| matches!(h, Ev::BlindExp { source } if *source == u));
                    if self
                        .q
                        .clear_matching(|h| matches!(h, Ev::AutoAttack { source } if *source == u))
                    {
                        self.add_next_attack(u)?;
                    }
                    self.q.add(exp, Ev::BlindExp { source: u });
                }
                if g.did_hit
                    && i.silence_chance > 0.0
                    && self.rng.next()
                        < (i.silence_chance * 100.0) / (100.0 + self.units[u].s[TENACITY])
                {
                    let exp = self.time + i.silence_duration;
                    self.units[u].silenced = true;
                    self.units[u].silence_expire = Some(exp);
                    self.q
                        .clear_matching(|h| matches!(h, Ev::SilenceExp { source } if *source == u));
                    if self
                        .q
                        .clear_matching(|h| matches!(h, Ev::CastEnd { source, .. } if *source == u))
                    {
                        self.add_next_attack(u)?;
                    }
                    self.q.add(exp, Ev::SilenceExp { source: u });
                }
                if g.did_hit && self.units[e].s[CURSE] > 0.0 {
                    let amt = self.units[e].s[CURSE];
                    self.apply_capped_debuff(u, amt, true, e);
                }
                if self.units[e].s[FURY] > 0.0 {
                    self.fury(e, g.did_hit, false);
                }
                if self.units[u].s[WEAKEN] > 0.0 {
                    let amt = self.units[u].s[WEAKEN];
                    self.apply_capped_debuff(e, amt, false, u);
                }
                self.res
                    .add_attack(eh, uh, t.hid, if g.did_hit { Some(g.damage_done) } else { None });
                if g.thorn_damage > 0.0 {
                    let tn = self.thorn_name(g.thorn_physical);
                    self.res.add_attack(uh, eh, tn, Some(g.thorn_damage));
                }
                if g.thorn_damage > 0.0 { self.log_damage(Some(u), if g.thorn_physical {"physicalThorns"} else {"elementalThorns"}, e, g.thorn_damage, false); }
                if self.units[u].s[RETALIATION] > 0.0 {
                    let rn = self.s_retaliation;
                    self.res.add_attack(
                        uh,
                        eh,
                        rn,
                        if g.retaliation_damage > 0.0 { Some(g.retaliation_damage) } else { None },
                    );
                }
                if g.retaliation_damage > 0.0 { self.log_damage(Some(u), "retaliation", e, g.retaliation_damage, false); }
                if self.units[u].d.hp == 0.0 {
                    self.kill(u);
                }
                if g.did_hit && i.pierce_chance > self.rng.next() {
                    continue;
                }
            }
            if par.is_some() || i.target == Target::Enemy {
                break;
            }
        }
        Ok(())
    }


    fn probe_heal(&self,e:usize,i:&Effect)->f64{let u=&self.units[e];let amp=1.+u.s[HEALING_AMPLIFY];random_int(&mut self.rng.clone(),amp*(1.+i.damage_flat),amp*(i.damage_ratio*u.d.max_dmg[IDX_MAGIC]+i.damage_flat))}
    fn settle_cooldowns(&mut self){
        let mut finished=Vec::new();
        for(&(id,hid),cycle)in &self.cooldown_cycles{
            let u=&self.units[id];let ab=u.abilities.iter().flatten().find(|a|a.def.hid==hid);
            match ab{
                Some(ab) if (ab.last_used-cycle.last_used).abs()<1e5 =>{
                    let haste=u.s[ABILITY_HASTE];let cd=if haste>0.{ab.def.cooldown*100./(100.+haste)}else{ab.def.cooldown};
                    if ab.last_used+cd<=self.time{finished.push(((id,hid),true));}else if u.d.hp<=0.{finished.push(((id,hid),false));}
                }
                _=>finished.push(((id,hid),false))
            }
        }
        for(key,valid)in finished{if let Some(c)=self.cooldown_cycles.remove(&key){if valid&&c.shift>0.{let rows=self.cooldown_observations.entry(c.phase).or_default();let ability=self.it.name(key.1);let idx=rows.iter().position(|r|r["slot"]==key.0&&r["ability"]==ability);let idx=idx.unwrap_or_else(||{rows.push(json!({"slot":key.0,"ability":ability,"count":0.,"seconds":0.,"originalSeconds":0.}));rows.len()-1});let row=&mut rows[idx];row["count"]=json!(row["count"].as_f64().unwrap_or(0.)+1.);row["seconds"]=json!(row["seconds"].as_f64().unwrap_or(0.)+c.shift.min(c.original)/1e9);row["originalSeconds"]=json!(row["originalSeconds"].as_f64().unwrap_or(0.)+c.original/1e9);}}}
    }
    fn process_heal(&mut self, e: UnitId, i: &Effect, target: UnitId) -> Result<f64, SimErr> {
        if !i.style_is_magic {
            return Err("Heal ability effect not supported for combat style".into());
        }
        let u = &self.units[e];
        let a = 1.0 + u.s[HEALING_AMPLIFY];
        let n = u.d.max_dmg[IDX_MAGIC];
        let o = i.damage_flat;
        let s = i.damage_ratio;
        let l = a * (1.0 + o);
        let c = a * (s * n + o);
        let v = random_int(&mut self.rng, l, c);
        let amount=self.units[target].add_hp(v);
        if self.observe_weapons&&e<self.players.len(){self.weapon_stats[e].total_healing+=amount;}
        Ok(amount)
    }

    fn record_healing(&mut self, source: UnitId, ability: u32, amount: f64) {
        if self.trial.is_none() { return; }
        let h = self.it.name(self.units[source].hid);
        let a = self.it.name(ability);
        let obj = self.healing_done.as_object_mut().unwrap().entry(h.to_string()).or_insert_with(|| json!({}));
        let prior = obj[a].as_f64().unwrap_or(0.0); obj[a] = json!(prior + amount);
    }

    fn ability_heal(&mut self, e: UnitId, t: &AbilityDef, i: &Effect) -> Result<(), SimErr> {
        match i.target {
            Target::AllAllies => {
                let n = self.allies(e).ok_or("allies list missing")?;
                let alive: Units =
                    n.iter().copied().filter(|&o| self.units[o].d.hp > 0.0).collect();
                for o in alive {
                    let bloom_raw=if self.observe_weapons&&t.hrid.as_ref()=="bloom"{self.probe_heal(e,i)}else{0.};
                    let s = self.process_heal(e, i, o)?;
                    if e<5&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_attempted+=bloom_raw;if o<5{self.bloom_receivers[e][o]+=s;}}
                    let h = self.units[o].hid;
                    self.res.add_hp_gained(h, t.hid, s);
                    self.record_healing(e, t.hid, s);
                    if e<self.players.len()&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_healing+=s;}
                }
                Ok(())
            }
            Target::LowestHpAlly => {
                let n = self.allies(e).ok_or("allies list missing")?;
                let mut best: Option<UnitId> = None;
                for &s in n.iter() {
                    if self.units[s].d.hp <= 0.0 {
                        continue;
                    }
                    match best {
                        None => best = Some(s),
                        Some(o) => {
                            let l = self.units[s].d.hp / self.units[s].d.max_hp;
                            let c = self.units[o].d.hp / self.units[o].d.max_hp;
                            if l < c {
                                best = Some(s);
                            }
                        }
                    }
                }
                if let Some(o) = best {
                    let bloom_raw=if self.observe_weapons&&t.hrid.as_ref()=="bloom"{self.probe_heal(e,i)}else{0.};
                    let s = self.process_heal(e, i, o)?;
                    if e<5&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_attempted+=bloom_raw;if o<5{self.bloom_receivers[e][o]+=s;}}
                    let h = self.units[o].hid;
                    self.res.add_hp_gained(h, t.hid, s);
                    self.record_healing(e, t.hid, s);
                    if e<self.players.len()&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_healing+=s;}
                }
                Ok(())
            }
            Target::SelfT => {
                let bloom_raw=if self.observe_weapons&&t.hrid.as_ref()=="bloom"{self.probe_heal(e,i)}else{0.};
                let a = self.process_heal(e, i, e)?;
                if e<5&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_attempted+=bloom_raw;self.bloom_receivers[e][e]+=a;}
                let h = self.units[e].hid;
                self.res.add_hp_gained(h, t.hid, a);
                self.record_healing(e, t.hid, a);
                if e<self.players.len()&&t.hrid.as_ref()=="bloom"{self.weapon_stats[e].bloom_healing+=a;}
                Ok(())
            }
            _ => Err(format!("Unsupported target type for heal ability effect: {}", t.hrid)),
        }
    }

    fn ability_revive(&mut self, e: UnitId, t: &AbilityDef, i: &Effect) -> Result<(), SimErr> {
        if i.target != Target::DeadAlly {
            return Err(format!("Unsupported target type for revive ability effect: {}", t.hrid));
        }
        let list = self.allies(e).ok_or("allies list missing")?;
        let n = match list.iter().copied().find(|&o| self.units[o].d.hp <= 0.0) {
            Some(n) => n,
            None => return Ok(()),
        };
        let nh = self.units[n].hid;
        self.q
            .clear_matching(|s| matches!(s, Ev::PlayerRespawn { hrid } if *hrid == nh));
        self.units[n].remove_expired(self.time);
        if !i.style_is_magic {
            return Err("Heal ability effect not supported for combat style".into());
        }
        let (_, c) = {
            let u = &self.units[e];
            let a = 1.0 + u.s[HEALING_AMPLIFY];
            let nn = u.d.max_dmg[IDX_MAGIC];
            (a * (1.0 + i.damage_flat), a * (i.damage_ratio * nn + i.damage_flat))
        };
        let o = self.units[n].add_hp(c);
        {
            let tu = &mut self.units[n];
            tu.d.mp = tu.d.max_mp;
            tu.clear_ccs();
        }
        self.res.add_hp_gained(nh, t.hid, o);
        self.record_healing(e, t.hid, o);
        self.add_next_attack(n)?;
        if !self.units[e].is_player {
            self.res.update_time_spent_alive(self.it.name(nh), true, self.time);
        }
        Ok(())
    }

    fn ability_spend_hp(&mut self, e: UnitId, t: &AbilityDef, i: &Effect) -> Result<(), SimErr> {
        if i.target != Target::SelfT {
            return Err(format!("Unsupported target type for spend hp ability effect: {}", t.hrid));
        }
        let u = &mut self.units[e];
        let cur = u.d.hp;
        let n = (cur * i.spend_hp_ratio).floor();
        u.d.hp -= n;
        let h = u.hid;
        self.res.add_hp_spent(h, t.hid, n);
        Ok(())
    }
}

fn compare(tr: &Trigger, v: Val) -> Result<bool, SimErr> {
    let x = tr.value;
    Ok(match (tr.cmp, v) {
        (Cmp::Unknown, _) => return Err("Unknown comparatorHrid in trigger".into()),
        (Cmp::Gte, Val::Num(a)) => a >= x,
        (Cmp::Lte, Val::Num(a)) => a <= x,
        (Cmp::IsActive, Val::Num(a)) => js::truthy(a),
        (Cmp::IsInactive, Val::Num(a)) => !js::truthy(a),
        (Cmp::Gte, Val::Bool(b)) => (if b { 1.0 } else { 0.0 }) >= x,
        (Cmp::Lte, Val::Bool(b)) => (if b { 1.0 } else { 0.0 }) <= x,
        (Cmp::IsActive, Val::Bool(b)) => b,
        (Cmp::IsInactive, Val::Bool(b)) => !b,
        (Cmp::Gte, Val::Obj(_)) | (Cmp::Lte, Val::Obj(_)) => false,
        (Cmp::IsActive, Val::Obj(p)) => p,
        (Cmp::IsInactive, Val::Obj(p)) => !p,
        (Cmp::Gte, Val::Str) | (Cmp::Lte, Val::Str) => false,
        (Cmp::IsActive, Val::Str) => true,
        (Cmp::IsInactive, Val::Str) => false,
    })
}

/// Per-skill share of combat experience (`addExperienceGain`'s `i` object).
fn xp_weights(primary: &str, focus: &str, map: Vec<String>) -> [f64; 7] {
    let mut i = [0.0f64; 7];
    if let Some(k) = primary.split('/').nth(2).and_then(skill_index) {
        i[k] = 0.3;
    }
    let o = map.len() as f64;
    if !focus.is_empty() && map.iter().any(|m| m == focus) {
        if let Some(k) = focus.split('/').nth(2).and_then(skill_index) {
            i[k] += 0.7;
        }
    } else {
        for l in &map {
            if let Some(k) = l.split('/').nth(2).and_then(skill_index) {
                i[k] += 0.7 / o;
            }
        }
    }
    i
}

/// `x.calculateTickValue`
#[inline]
fn calc_tick(e: f64, t: f64, i: f64) -> f64 {
    let a = ((i * e) / t).floor();
    let n = (((i - 1.0) * e) / t).floor();
    a - n
}

/// `x.randomInt`
fn random_int(rng: &mut Rng, mut e: f64, mut t: f64) -> f64 {
    if t < e {
        std::mem::swap(&mut e, &mut t);
    }
    let i = e.ceil();
    let a = t.floor();
    if e.floor() == a {
        return ((e + t) / 2.0 + rng.next()).floor();
    }
    let n = -1.0 * (e - i);
    let o = t - a;
    let s = 2.0 * n + (a - i);
    let l = (a + i) / 2.0;
    let c = (t + e) / 2.0;
    let u = (s * (c - l)) / (a + 1.0 - c);
    let w = (u / (u + s)).abs();
    if rng.next() < w {
        if o > n {
            (a + 1.0).floor()
        } else {
            (i - 1.0).floor()
        }
    } else if o > n {
        (e + rng.next() * (a + n - e + 1.0)).floor()
    } else {
        (i - o + rng.next() * (t - (i - o) + 1.0)).floor()
    }
}

// [events, current-layer sum, effective/snapshot-layer sum, damage,
//  damage*current layers, damage*effective layers]; zero-layer damage is included.
fn record_layer_stats(stats: &mut [f64;6], current: f64, effective: f64, damage: f64) {
    stats[0] += 1.0; stats[1] += current; stats[2] += effective;
    stats[3] += damage; stats[4] += damage*current; stats[5] += damage*effective;
}


fn allocate(matrix: &mut [[f64;5];5], dealer: usize, bonus: f64, owners: [f64;5]) {
    if dealer>=5 { return; }
    let total: f64=owners.iter().sum();
    if total>0.0 { for owner in 0..5 { if dealer!=owner { matrix[dealer][owner]+=bonus*owners[owner]/total; } } }
}

#[cfg(test)]mod attribution_tests{
 use super::*;
 #[test]fn effective_sources_cap_expiry_and_dot_snapshot(){
  let gdv:Value=serde_json::from_str(include_str!("../../resources/native-game-data.json")).unwrap();
  let gd=GameData::from_json(&gdv).unwrap();let input:Value=serde_json::from_str(include_str!("../../tests/fixtures/team-1-input.json")).unwrap();let mut sim=Sim::new(&gd,&input["scenario"],false).unwrap();sim.simulate(1e6).unwrap();let target=sim.enemies.as_ref().unwrap()[0];sim.q.clear_matching(|e|matches!(e,Ev::CurseExp{source,..}if *source==target));sim.units[target].remove_buffs(&[sim.u_curse]);sim.owners.remove(&target);sim.units[2].s[CURSE]=0.022;sim.units[4].s[CURSE]=0.022;
  for _ in 0..3{sim.apply_capped_debuff(target,0.022,true,2);}for _ in 0..2{sim.apply_capped_debuff(target,0.022,true,4);}let snapshot=sim.owners[&target];assert!((snapshot[2]-0.066).abs()<1e-10);assert!((snapshot[4]-0.044).abs()<1e-10);assert!((sim.live_curse_layers(target)-5.).abs()<1e-10);
  sim.apply_capped_debuff(target,0.022,true,4);assert_eq!(sim.owners[&target],snapshot);
  sim.time+=15e9;sim.process(Ev::CurseExp{source:target,amount:0.11}).unwrap();assert_eq!(sim.live_curse_layers(target),0.);
  sim.units[target].d.hp=1000.;sim.transfers=[[0.;5];5];sim.on_dot(0,target,100.,1.,1.,10.,5.,snapshot).unwrap();assert!((sim.transfers[0][2]-6.).abs()<1e-10);assert!((sim.transfers[0][4]-4.).abs()<1e-10);
 }
 #[test]fn self_contribution_is_not_transferred(){let mut m=[[0.;5];5];allocate(&mut m,2,10.,[0.,0.,0.066,0.,0.044]);assert_eq!(m[2][2],0.);assert!((m[2][4]-4.).abs()<1e-10);}
}

struct CooldownCycle{started:f64,last_used:f64,shift:f64,original:f64,phase:String}
fn merge_weapon_delta(map:&mut HashMap<String,Value>,phase:&str,start:&[WeaponStats;5],end:&[WeaponStats;5]){
 let a=json!(start);let b=json!(end);let old=map.entry(phase.into()).or_insert_with(||json!([{}, {}, {}, {}, {}]));
 for id in 0..5{for(k,v)in b[id].as_object().unwrap(){let delta=v.as_f64().unwrap_or(0.)-a[id][k].as_f64().unwrap_or(0.);let n=old[id][k].as_f64().unwrap_or(0.);old[id][k]=json!(n+delta);}}
}
// Read-only direct-damage probe: copies RNG, never writes a live unit or schedules an event.
fn direct_damage_boost(e: &Unit, _t: &Unit, is_ability: bool, damage_taken: f64) -> f64 {
    (1.0 + if e.task_damage_enabled { e.s[TASK_DAMAGE] } else { 0.0 })
        * (1.0 + damage_taken)
        * (1.0 + if is_ability { e.s[ABILITY_DAMAGE] } else { e.s[AUTO_ATTACK_DAMAGE] })
}
fn probe_direct_damage(e:&Unit,t:&Unit,eff:Option<&Effect>,rng:Rng)->f64{probe_direct_damage_kind(e,t,eff,eff.is_some(),rng)}
fn probe_direct_damage_kind(e:&Unit,t:&Unit,eff:Option<&Effect>,is_ability:bool,mut rng:Rng)->f64{probe_direct_damage_rng_kind(e,t,eff,is_ability,&mut rng)}
fn probe_direct_damage_rng(e:&Unit,t:&Unit,eff:Option<&Effect>,rng:&mut Rng)->f64{probe_direct_damage_rng_kind(e,t,eff,eff.is_some(),rng)}
fn probe_direct_damage_rng_kind(e:&Unit,t:&Unit,eff:Option<&Effect>,is_ability:bool,rng:&mut Rng)->f64{
        let style = eff.map(|x| x.style).unwrap_or(e.style);
        let dtype = eff.map(|x| x.dtype).unwrap_or(e.dtype);
        let (mut o, s, l) = match style {
            Style::Stab => (e.d.acc[IDX_STAB], e.d.max_dmg[IDX_STAB], t.d.eva[IDX_STAB]),
            Style::Slash => (e.d.acc[IDX_SLASH], e.d.max_dmg[IDX_SLASH], t.d.eva[IDX_SLASH]),
            Style::Smash => (e.d.acc[IDX_SMASH], e.d.max_dmg[IDX_SMASH], t.d.eva[IDX_SMASH]),
            Style::Ranged => (e.d.acc[IDX_RANGED], e.d.max_dmg[IDX_RANGED], t.d.eva[IDX_RANGED]),
            Style::Magic => (e.d.acc[IDX_MAGIC], e.d.max_dmg[IDX_MAGIC], t.d.eva[IDX_MAGIC]),
            Style::Other => return 0.,
        };
        let (c, _u, pen, g, _p, _h, _thorn_physical) = match dtype {
            DType::Physical => (
                1.0 + e.s[PHYSICAL_AMPLIFY],
                e.d.total_armor,
                e.s[ARMOR_PENETRATION],
                t.d.total_armor,
                t.s[PHYSICAL_THORNS],
                t.s[ARMOR_PENETRATION],
                true,
            ),
            DType::Water => (
                1.0 + e.s[WATER_AMPLIFY],
                e.d.total_water_res,
                e.s[WATER_PENETRATION],
                t.d.total_water_res,
                t.s[ELEMENTAL_THORNS],
                t.s[WATER_PENETRATION],
                false,
            ),
            DType::Nature => (
                1.0 + e.s[NATURE_AMPLIFY],
                e.d.total_nature_res,
                e.s[NATURE_PENETRATION],
                t.d.total_nature_res,
                t.s[ELEMENTAL_THORNS],
                t.s[NATURE_PENETRATION],
                false,
            ),
            DType::Fire => (
                1.0 + e.s[FIRE_AMPLIFY],
                e.d.total_fire_res,
                e.s[FIRE_PENETRATION],
                t.d.total_fire_res,
                t.s[ELEMENTAL_THORNS],
                t.s[FIRE_PENETRATION],
                false,
            ),
            DType::Other => return 0.,
        };
        let r_crit = e.s[CRITICAL_RATE];
        let pe = e.s[CRITICAL_DAMAGE];
        if let Some(i) = eff {
            o *= 1.0 + i.bonus_accuracy_ratio;
        }
        let po = js::pow(o, 1.4);
        let f = po / (po + js::pow(l, 1.4));
        let mut k = 0.0;
        if style == Style::Ranged {
            k = 0.3 * f;
        }
        k = k + r_crit;
        let n_flat = eff.map(|i| i.damage_flat).unwrap_or(0.0);
        let j_ratio = eff.map(|i| i.damage_ratio).unwrap_or(1.0);
        let j = eff.map(|i| i.armor_damage_ratio * e.d.total_armor).unwrap_or(0.0);
        let mut lo = c * (1.0 + n_flat + j);
        let mut hi = c * (j_ratio * s + n_flat + j);
        let is_crit = rng.next() < k;
        if is_crit {
            hi = hi * (1.0 + pe);
            lo = hi;
        }
        let boost = direct_damage_boost(e, t, is_ability, t.s[DAMAGE_TAKEN]);
        let q = random_int(rng, lo * boost, hi * boost);
        let mut dmg = 0.0;
        if rng.next() < f {
            let mut tt = g;
            if pen > 0.0 && g > 0.0 {
                tt = g / (1.0 + pen);
            }
            let mut w = 100.0 / (100.0 + tt);
            if tt < 0.0 {
                w = (100.0 - tt) / 100.0;
            }
            let de = (w * q).ceil();
            dmg = js::min(de, t.d.hp);

        }
        dmg
}

#[cfg(test)]
#[path = "backend_rules_tests.rs"]
mod backend_rules_tests;
