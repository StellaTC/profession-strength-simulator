//! Mechanism expectations from chezecow's 2026-10-29 backend review.
//! These are rule tests, not captures from the private backend.
use super::*;

fn with_sim(f: impl FnOnce(&mut Sim<'_>)) {
    let raw: Value = serde_json::from_str(include_str!("../../resources/native-game-data.json")).unwrap();
    let gd = GameData::from_json(&raw).unwrap();
    let input: Value = serde_json::from_str(include_str!("../../tests/fixtures/team-1-input.json")).unwrap();
    let mut sim = Sim::new(&gd, &input["scenario"], true).unwrap();
    sim.simulate(1e6).unwrap();
    sim.q.clear();
    for p in 0..5 { sim.units[p].abilities.clear(); sim.units[p].food.clear(); sim.units[p].drinks.clear(); }
    f(&mut sim);
}
fn buff(unique: u32, typ: u32, ratio: f64) -> BuffTemplate {
    BuffTemplate { source_level: 1., unique, typ, ratio, flat: 0., duration: 300e9,
        has_multiplier_skill: false, multiplier_skill: None, multiplier_per_level: 0. }
}
fn close(a: f64, b: f64) { assert!((a-b).abs() < 1e-8, "{a} != {b}"); }

#[test]
fn threat_keeps_base_with_taunt_and_provoke() {
    with_sim(|s| {
        if let Kind::Player(p) = &mut s.units[0].kind { p.equip.retain(|(k,_)| *k != THREAT); }
        s.units[0].permanent.clear(); s.units[0].clear_buffs();
        let id = s.it.id("/buff_uniques/test_threat");
        for (gear, ratio, expected) in [(0.,2.5,350.), (0.,5.,600.), (30.,2.5,455.)] {
            if let Kind::Player(p) = &mut s.units[0].kind { p.equip.retain(|(k,_)| *k != THREAT); p.equip.push((THREAT,gear)); }
            s.units[0].replace_buff(&buff(id,bt::THREAT,ratio),s.time);
            close(s.units[0].s[THREAT],expected);
            close(s.units[0].d.total_threat,expected);
        }
    });
}
#[test]
fn fury_shares_damage_and_accuracy_buckets() {
    with_sim(|s| {
        let u = &mut s.units[0]; u.permanent.clear(); u.clear_buffs();
        let base = u.d.clone();
        u.add_buffs(&[buff(s.it.id("test_damage"),bt::DAMAGE,0.5),buff(s.it.id("test_accuracy"),bt::ACCURACY,0.5),
            buff(s.u_fury_dmg,bt::FURY_DAMAGE,0.25),buff(s.u_fury_acc,bt::FURY_ACCURACY,0.25)],s.time);
        for i in 0..5 { close(u.d.max_dmg[i]/base.max_dmg[i],1.75); close(u.d.acc[i]/base.acc[i],1.75); }
    });
}
#[test]
fn parry_checks_party_order_and_combines_chances() {
    with_sim(|s| {
        for u in &mut s.units { u.s[PARRY]=0.; }
        s.units[0].s[PARRY]=1.; s.units[1].s[PARRY]=1.;
        assert_eq!(s.check_parry(&[0,1]),Some(0));
        s.units[0].s[PARRY]=0.08; s.units[1].s[PARRY]=0.08;
        s.rng=Rng::new(42.);
        let count=(0..100_000).filter(|_|s.check_parry(&[0,1]).is_some()).count();
        assert!((count as f64/100_000.-0.1536).abs()<0.003);
        let mut extra=s.units[0].clone(); extra.s[PARRY]=1.; s.units.push(extra);
        let last=s.units.len()-1;
        for i in 0..5 {s.units[i].s[PARRY]=f64::MIN_POSITIVE;}
        let before=s.rng.calls;
        assert_eq!(s.check_parry(&[0,1,2,3,4,last]),None);
        assert_eq!(s.rng.calls-before,5);
    });
}
#[test]
fn parry_counters_do_not_apply_weapon_stacks() {
    with_sim(|s| {
        let m=s.enemies.as_ref().unwrap()[0];
        for p in 0..5 {s.units[p].s[PARRY]=0.;}
        s.units[0].s[PARRY]=1.; s.units[0].s[CURSE]=0.022; s.units[0].s[FURY]=0.03;
        s.units[m].s[WEAKEN]=0.03; s.units[m].d.hp=1e9;
        s.units[0].remove_buffs(&[s.u_fury_acc,s.u_fury_dmg]);
        s.units[0].s[CURSE]=0.022; s.units[0].s[FURY]=0.03;
        s.on_auto_attack(m).unwrap();
        assert!(!s.units[m].combat_buffs.contains_key(&s.u_curse));
        assert!(!s.units[0].combat_buffs.contains_key(&s.u_fury_acc));
        assert!(!s.units[0].combat_buffs.contains_key(&s.u_weaken));
        assert_eq!(s.weapon_stats[0].parries,1.);
    });
}
#[test]
fn promotion_replaces_and_initializes_unit_at_same_health_ratio() {
    with_sim(|s| {
        let pawn=s.spawn_monster("/monsters/enchanted_pawn",1.,0.).unwrap();
        s.units[pawn].reset(s.time,&mut s.rng); s.units[pawn].d.hp=s.units[pawn].d.max_hp*0.37;
        s.enemies=Some(Rc::from(vec![pawn]));
        s.q.add(s.time+1e9,Ev::AutoAttack{source:pawn});
        let promoted=s.promote(pawn).unwrap();
        assert_eq!(s.enemies.as_ref().unwrap().as_ref(),&[promoted]);
        close(s.units[promoted].d.hp/s.units[promoted].d.max_hp,0.37);
        assert!(s.units[promoted].d.max_hp>110.); assert!(s.units[promoted].d.max_dmg.iter().any(|n|*n>11.));
        assert_eq!(s.units[promoted].difficulty_tier,1.);
        assert!(!s.q.any(|e|e.source()==Some(pawn)));
        assert_eq!(s.units[pawn].d.hp,0.);
        s.add_next_attack(promoted).unwrap(); assert!(s.q.any(|e|e.source()==Some(promoted)));
    });
}
#[test]
fn zero_cooldown_spells_are_last_even_in_first_slot() {
    with_sim(|s| {
        s.units[0].abilities=vec![Some(s.default_ability("/abilities/water_strike",100.).unwrap()),Some(s.default_ability("/abilities/frost_surge",100.).unwrap())];
        for a in s.units[0].abilities.iter_mut().flatten(){a.triggers=Rc::new(vec![]);a.last_used=MIN_SAFE_INTEGER;}
        s.units[0].d.mp=1e9; s.units[0].clear_ccs();
        s.add_next_attack(0).unwrap();
        assert!(s.q.any(|e|matches!(e,Ev::CastEnd{source:0,slot:1})));
    });
}
#[test]
fn revive_uses_maximum_without_random_roll() {
    with_sim(|s| {
        let a=s.ability_def("/abilities/revive",100.).unwrap(); let eff=&a.effects[0];
        s.units[1].d.hp=0.; s.units[1].d.max_hp=1e9;
        let expected=(1.+s.units[0].s[HEALING_AMPLIFY])*(eff.damage_ratio*s.units[0].d.max_dmg[IDX_MAGIC]+eff.damage_flat);
        let calls=s.rng.calls;
        s.ability_revive(0,&a,eff).unwrap();
        close(s.units[1].d.hp,expected); close(s.units[1].d.mp,s.units[1].d.max_mp);
        assert_eq!(s.rng.calls,calls);
    });
}
#[test]
fn respawn_keeps_running_buffs_and_discards_expired_ones() {
    with_sim(|s| {
        let active=s.it.id("test_active"); let expired=s.it.id("test_expired");
        s.units[0].add_buff(&buff(active,bt::DAMAGE,0.2),s.time);
        let mut b=buff(expired,bt::MAX_HITPOINTS,0.5); b.duration=1.; s.units[0].add_buff(&b,s.time-2.);
        s.units[0].d.hp=0.; s.units[0].d.mp=0.;
        s.on_player_respawn(s.units[0].hid).unwrap();
        assert!(s.units[0].combat_buffs.contains_key(&active)); assert!(!s.units[0].combat_buffs.contains_key(&expired));
        close(s.units[0].d.hp,s.units[0].d.max_hp); close(s.units[0].d.mp,s.units[0].d.max_mp);
    });
}
#[test]
fn stronger_skill_can_replace_weaker_same_debuff() {
    with_sim(|s| {
        let target=s.enemies.as_ref().unwrap()[0];
        let weak=s.ability_def("/abilities/puncture",40.).unwrap(); let strong=s.ability_def("/abilities/puncture",100.).unwrap();
        let bs=weak.effects.iter().find_map(|e|e.buffs.as_ref()).unwrap();
        s.units[target].add_buffs(bs,s.time);
        let tr=Trigger{single_target:true,dep:Dep::TargetedEnemy,cond:Cond::BuffExact(bs[0].unique),cmp:Cmp::IsInactive,value:0.};
        assert!(!s.trigger_active(&tr,0,Some(target),None,None,Some(&weak)).unwrap());
        assert!(s.trigger_active(&tr,0,Some(target),None,None,Some(&strong)).unwrap());
        assert!(!s.trigger_active(&tr,0,Some(target),None,None,None).unwrap());
        let strong_bs=strong.effects.iter().find_map(|e|e.buffs.as_ref()).unwrap(); s.units[target].add_buffs(strong_bs,s.time);
        assert!(!s.trigger_active(&tr,0,Some(target),None,None,Some(&strong)).unwrap());
    });
}
#[test]
fn boss_status_and_cc_expiry_are_supported() {
    with_sim(|s| {
        let boss=s.gd.monsters.iter().find(|(_,v)|v["isBoss"]==true).unwrap().0.clone();
        let boss=s.spawn_monster(&boss,0.,0.).unwrap();
        let tr=Trigger::from_def(&json!({"dependencyHrid":"/combat_trigger_dependencies/targeted_enemy","conditionHrid":"/combat_trigger_conditions/boss_status","comparatorHrid":"/combat_trigger_comparators/is_active"}),s.gd,&mut s.it);
        assert!(s.trigger_active(&tr,0,Some(boss),None,None,None).unwrap());
        assert!(!s.trigger_active(&tr,0,Some(0),None,None,None).unwrap());
        let mut cc=tr.clone(); cc.cond=Cond::StunStatus;
        s.units[0].stunned=true; s.units[0].stun_expire=Some(s.time);
        assert!(!s.trigger_active(&cc,1,Some(0),None,None,None).unwrap());
        s.units[0].stun_expire=Some(s.time+1.);
        assert!(s.trigger_active(&cc,1,Some(0),None,None,None).unwrap());
    });
}
#[test]
fn damage_rounding_and_shadow_probe_use_same_boosted_bounds() {
    with_sim(|s| {
        let target=s.enemies.as_ref().unwrap()[0];
        let a=s.ability_def("/abilities/water_strike",100.).unwrap(); let mut e=a.effects[0].clone();
        e.style=Style::Magic; e.dtype=DType::Water; e.damage_flat=0.2; e.damage_ratio=1.35; e.armor_damage_ratio=0.;
        s.units[0].d.max_dmg[IDX_MAGIC]=101.3; s.units[0].d.acc[IDX_MAGIC]=1e20;
        s.units[0].s[CRITICAL_RATE]=0.; s.units[0].s[WATER_AMPLIFY]=0.; s.units[0].s[ABILITY_DAMAGE]=0.43;
        s.units[0].task_damage_enabled=false; s.units[target].d.eva[IDX_MAGIC]=1.; s.units[target].d.total_water_res=0.;
        s.units[target].s[DAMAGE_TAKEN]=0.17; s.units[target].d.hp=1e9;
        let mut r=Rng::new(42.); r.next();
        let expected=random_int(&mut r,1.2*1.43*1.17,(1.35*101.3+0.2)*1.43*1.17).ceil();
        s.rng=Rng::new(42.);
        let probe=probe_direct_damage(&s.units[0],&s.units[target],Some(&e),s.rng.clone());
        let actual=s.process_attack(0,target,Some(&e)).unwrap();
        close(actual.damage_done,expected); close(probe,expected);
    });
}
#[test]
fn blaze_does_not_receive_ability_damage() {
    with_sim(|s| {
        let target=s.enemies.as_ref().unwrap()[0]; s.enemies=Some(Rc::from(vec![target]));
        let a=s.ability_def("blaze",1.).unwrap(); let eff=&a.effects[0];
        s.units[target].s[PARRY]=0.; s.units[0].s[ABILITY_DAMAGE]=0.; s.units[target].d.hp=1e9; s.rng=Rng::new(45.);
        s.ability_damage(0,&a,eff).unwrap(); let base=1e9-s.units[target].d.hp;
        s.units[0].s[ABILITY_DAMAGE]=9.; s.units[target].d.hp=1e9; s.rng=Rng::new(45.);
        s.ability_damage(0,&a,eff).unwrap(); close(1e9-s.units[target].d.hp,base);
        assert!(base>0.);
    });
}
#[test]
fn max_hp_rounds_and_hp_drain_ceil() {
    with_sim(|s| {
        if let Kind::Player(p)=&mut s.units[0].kind {p.equip.clear();} s.units[0].base_level=[100.;7]; s.units[0].s[MAX_HITPOINTS]=0.; s.units[0].s[MAX_HITPOINTS_RATIO]=0.;
        s.units[0].permanent.clear(); s.units[0].clear_buffs(); let old=s.units[0].d.max_hp;
        let mut b=buff(s.it.id("test_hp"),bt::MAX_HITPOINTS,0.); b.flat=0.75;
        s.units[0].add_buff(&b,s.time); close(s.units[0].d.max_hp,old+1.);
        let target=s.enemies.as_ref().unwrap()[0]; let a=s.ability_def("/abilities/water_strike",100.).unwrap(); let mut e=a.effects[0].clone();
        e.hp_drain_ratio=0.00001; s.units[0].d.hp=1.; s.units[0].d.acc=[1e20;5]; s.units[target].d.eva=[1.;5]; s.units[target].d.hp=1e9;
        let out=s.process_attack(0,target,Some(&e)).unwrap(); assert!(out.did_hit); assert!(out.damage_done>0.); close(out.hp_drain,1.);
    });
}
#[test]
fn shorter_stun_never_shortens_existing_stun() {
    with_sim(|s| {
        let target=s.enemies.as_ref().unwrap()[0]; s.enemies=Some(Rc::from(vec![target]));
        let a=s.ability_def("/abilities/water_strike",100.).unwrap(); let mut e=a.effects[0].clone();
        e.stun_chance=1.; e.stun_duration=1e9; s.units[0].d.acc=[1e20;5]; s.units[target].d.eva=[1.;5]; s.units[target].s[TENACITY]=0.; s.units[target].s[PARRY]=0.; s.units[target].d.hp=1e9;
        s.units[target].stunned=true; s.units[target].stun_expire=Some(s.time+10e9);
        s.ability_damage(0,&a,&e).unwrap(); close(s.units[target].stun_expire.unwrap(),s.time+10e9);
    });
}

#[test]
fn retired_monster_actions_do_not_cross_encounters_or_advance_rng() {
    with_sim(|s| {
        let old=s.spawn_monster("/monsters/abyssal_imp",1.,0.).unwrap();
        s.units[old].reset(s.time,&mut s.rng);
        let slot=s.units[old].abilities.iter().position(|a|a.as_ref().is_some_and(|a|a.def.hrid.as_ref()=="/abilities/fireball")).unwrap();
        let health=s.players.iter().map(|&p|s.units[p].d.hp).collect::<Vec<_>>();
        let mana=s.units[old].d.mp;let calls=s.rng.calls;
        let active=s.enemies.clone();
        for roster in [None,active] {
            s.enemies=roster;
            let events=s.q.len();
            assert!(!s.try_use_ability(old,slot).unwrap());
            s.on_auto_attack(old).unwrap();
            s.add_next_attack(old).unwrap();
            s.process(Ev::CastEnd{source:old,slot}).unwrap();
            assert_eq!(s.q.len(),events);
            close(s.units[old].d.mp,mana);
            assert_eq!(s.rng.calls,calls);
            assert_eq!(s.players.iter().map(|&p|s.units[p].d.hp).collect::<Vec<_>>(),health);
        }
    });
}
#[test]
fn retired_monster_dot_still_ticks_and_current_monster_still_schedules() {
    with_sim(|s| {
        let old=s.spawn_monster("/monsters/abyssal_imp",1.,0.).unwrap();
        let hp=s.units[0].d.hp;
        s.on_dot(old,0,10.,1.,1.,0.,0.,[0.;5]).unwrap();
        close(s.units[0].d.hp,hp-10.);
        let active=s.enemies.as_ref().unwrap()[0];
        s.add_next_attack(active).unwrap();
        assert!(s.q.any(|ev|matches!(ev,Ev::CastEnd{source,..}|Ev::AutoAttack{source} if *source==active)));
    });
}
