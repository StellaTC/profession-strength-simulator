from pathlib import Path
p=Path('engine/src/sim.rs');s=p.read_text()
s=s.replace('    curse_credit: [[f64; 4]; 5],','    curse_credit: [[f64; 4]; 5],\n    owners: HashMap<usize, [f64;5]>,\n    transfers: [[f64;5];5],')
s=s.replace('            curse_credit: [[0.0; 4]; 5],','            curse_credit: [[0.0; 4]; 5],\n            owners: HashMap::default(),\n            transfers: [[0.0;5];5],')
s=s.replace('        result["curseAttributionByPlayer"]', '        result["curseTransfers"] = json!(self.transfers);\n        result["curseAttributionByPlayer"]',1)
s=s.replace('    curse_snapshot_layers: f64,','    curse_snapshot_layers: f64,\n    curse_owners: [f64;5],')
s=s.replace('        let (e, t) = two(&mut self.units, src, tgt);','        let target_owners = self.owners.get(&tgt).copied().unwrap_or([0.0;5]);\n        let source_owners = self.owners.get(&src).copied().unwrap_or([0.0;5]);\n        let (e, t) = two(&mut self.units, src, tgt);',1)
s=s.replace('                self.curse_credit[src][0] += curse_bonus;','                allocate(&mut self.transfers, src, curse_bonus, target_owners);\n                self.curse_credit[src][0] += curse_bonus;')
s=s.replace('                self.curse_credit[tgt][2] += bonus;','                allocate(&mut self.transfers, tgt, bonus, source_owners);\n                self.curse_credit[tgt][2] += bonus;')
s=s.replace('                    self.curse_credit[tgt][3] += bonus;','                    allocate(&mut self.transfers, tgt, bonus, source_owners);\n                    self.curse_credit[tgt][3] += bonus;')
s=s.replace('            curse_snapshot_layers: (target_curse / 0.022).round(),','            curse_snapshot_layers: (target_curse / 0.022).round(),\n            curse_owners: target_owners,')
s=s.replace('curse_layers: f64) -> Result<(), SimErr>', 'curse_layers: f64, curse_owners: [f64;5]) -> Result<(), SimErr>')
s=s.replace('                curse_layers,\n            } => self.on_dot', '                curse_layers, curse_owners,\n            } => self.on_dot')
s=s.replace('damage, total, current, curse_bonus, curse_layers)?','damage, total, current, curse_bonus, curse_layers, curse_owners)?')
s=s.replace('            self.curse_credit[source_ref][1] += bonus;','            allocate(&mut self.transfers, source_ref, bonus, curse_owners);\n            self.curse_credit[source_ref][1] += bonus;')
s=s.replace('                    curse_layers,\n','                    curse_layers, curse_owners,\n')
s=s.replace('                            curse_layers: g.curse_snapshot_layers,','                            curse_layers: g.curse_snapshot_layers,\n                            curse_owners: g.curse_owners,')
s=s.replace('fn apply_capped_debuff(&mut self, e: UnitId, t: f64, curse: bool)', 'fn apply_capped_debuff(&mut self, e: UnitId, t: f64, curse: bool, owner: UnitId)')
s=s.replace('self.apply_capped_debuff(l, amt, true)', 'self.apply_capped_debuff(l, amt, true, c)')
s=s.replace('self.apply_capped_debuff(u, amt, true)', 'self.apply_capped_debuff(u, amt, true, e)')
s=s.replace('self.apply_capped_debuff(c, amt, false)', 'self.apply_capped_debuff(c, amt, false, l)')
s=s.replace('self.apply_capped_debuff(e, amt, false)', 'self.apply_capped_debuff(e, amt, false, u)')
s=s.replace('        let (unique, typ, ratio, flat) = if curse {','        if curse {\n            let shares = self.owners.entry(e).or_insert([0.0;5]);\n            if n == 0.0 { *shares=[0.0;5]; }\n            if owner < 5 { shares[owner] += (amount-n).max(0.0); }\n        }\n        let (unique, typ, ratio, flat) = if curse {')
s=s.replace('            Ev::CurseExp { source, .. } | Ev::WeakenExp', '            Ev::CurseExp { source, .. } => { self.owners.remove(&source); self.units[source].remove_expired(self.time); }\n            Ev::WeakenExp',1)
# cooperative stop callback every 4096 events, keeping original event sequence.
s=s.replace('    pub fn simulate(&mut self, limit: f64) -> Result<(), SimErr> {','    pub fn simulate(&mut self, limit: f64) -> Result<(), SimErr> { self.simulate_controlled(limit, &|| true) }\n\n    pub fn simulate_controlled(&mut self, limit: f64, keep_running: &dyn Fn() -> bool) -> Result<(), SimErr> {')
s=s.replace('            let e = match self.q.pop()', '            if self.events_processed % 4096 == 0 && !keep_running() { return Err("interrupted".into()); }\n            let e = match self.q.pop()',1)
s+='''
fn allocate(matrix: &mut [[f64;5];5], dealer: usize, bonus: f64, owners: [f64;5]) {
    if dealer>=5 { return; }
    let total: f64=owners.iter().sum();
    if total>0.0 { for owner in 0..5 { if dealer!=owner { matrix[dealer][owner]+=bonus*owners[owner]/total; } } }
}
'''
p.write_text(s)
p=Path('engine/src/queue.rs');s=p.read_text().replace('curse_layers: f64 }','curse_layers: f64, curse_owners: [f64;5] }');p.write_text(s)
# lightweight damage totals irrespective of histogram recording
p=Path('engine/src/result.rs');s=p.read_text().replace('    pub record_attacks: bool,','    pub record_attacks: bool,\n    pub damage_totals: IndexMap<(u32,u32), f64>,').replace('            record_attacks,','            record_attacks,\n            damage_totals: IndexMap::default(),')
s=s.replace('        if !self.record_attacks {','        if let Some(d)=dmg { *self.damage_totals.entry((src,tgt)).or_default() += d; }\n        if !self.record_attacks {',1)
s=s.replace('        o.insert("attacks".into(), Value::Object(att));','        o.insert("attacks".into(), Value::Object(att));\n        o.insert("damageTotals".into(), json!(self.damage_totals.iter().map(|((s,t),d)| json!({"source":it.name(*s),"target":it.name(*t),"damage":d})).collect::<Vec<_>>()));')
p.write_text(s)
