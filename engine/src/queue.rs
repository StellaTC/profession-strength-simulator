//! Ordinary combat uses rounded time + sequence. Guild trial preserves the pinned
//! heap-js raw-time comparator and heap layout, including equal-time removals.

use crate::js;
use crate::unit::UnitId;

#[derive(Clone, Debug)]
pub enum Ev {
    CombatStart,
    PlayerRespawn { hrid: u32 },
    EnemyRespawn,
    AutoAttack { source: UnitId },
    ConsumableTick { source: UnitId, drink: bool, slot: usize, total: f64, current: f64 },
    Dot { source_ref: UnitId, target: UnitId, damage: f64, total: f64, current: f64, curse_bonus: f64, curse_layers: f64, curse_owners: [f64;5] },
    CheckBuffExpiration { source: UnitId },
    RegenTick,
    StunExp { source: UnitId },
    BlindExp { source: UnitId },
    SilenceExp { source: UnitId },
    CurseExp { amount: f64, source: UnitId },
    WeakenExp { amount: f64, source: UnitId },
    FuryExp { amount: f64, source: UnitId },
    EnrageTick { encounter_time: f64 },
    CastEnd { source: UnitId, slot: usize },
    AwaitCooldown { source: UnitId },
    CooldownReady,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EvType {
    CombatStart,
    PlayerRespawn,
    EnemyRespawn,
    AutoAttack,
    ConsumableTick,
    Dot,
    CheckBuffExpiration,
    RegenTick,
    StunExp,
    BlindExp,
    SilenceExp,
    CurseExp,
    WeakenExp,
    FuryExp,
    EnrageTick,
    CastEnd,
    AwaitCooldown,
    CooldownReady,
}

impl Ev {
    #[inline]
    pub fn ty(&self) -> EvType {
        match self {
            Ev::CombatStart => EvType::CombatStart,
            Ev::PlayerRespawn { .. } => EvType::PlayerRespawn,
            Ev::EnemyRespawn => EvType::EnemyRespawn,
            Ev::AutoAttack { .. } => EvType::AutoAttack,
            Ev::ConsumableTick { .. } => EvType::ConsumableTick,
            Ev::Dot { .. } => EvType::Dot,
            Ev::CheckBuffExpiration { .. } => EvType::CheckBuffExpiration,
            Ev::RegenTick => EvType::RegenTick,
            Ev::StunExp { .. } => EvType::StunExp,
            Ev::BlindExp { .. } => EvType::BlindExp,
            Ev::SilenceExp { .. } => EvType::SilenceExp,
            Ev::CurseExp { .. } => EvType::CurseExp,
            Ev::WeakenExp { .. } => EvType::WeakenExp,
            Ev::FuryExp { .. } => EvType::FuryExp,
            Ev::EnrageTick { .. } => EvType::EnrageTick,
            Ev::CastEnd { .. } => EvType::CastEnd,
            Ev::AwaitCooldown { .. } => EvType::AwaitCooldown,
            Ev::CooldownReady => EvType::CooldownReady,
        }
    }

    /// The event's `source` property (DOT events only have `sourceRef`, which does not count).
    #[inline]
    pub fn source(&self) -> Option<UnitId> {
        match *self {
            Ev::AutoAttack { source }
            | Ev::ConsumableTick { source, .. }
            | Ev::CheckBuffExpiration { source }
            | Ev::StunExp { source }
            | Ev::BlindExp { source }
            | Ev::SilenceExp { source }
            | Ev::CurseExp { source, .. }
            | Ev::WeakenExp { source, .. }
            | Ev::FuryExp { source, .. }
            | Ev::CastEnd { source, .. }
            | Ev::AwaitCooldown { source } => Some(source),
            _ => None,
        }
    }

    #[inline]
    pub fn target(&self) -> Option<UnitId> {
        match *self {
            Ev::Dot { target, .. } => Some(target),
            _ => None,
        }
    }
}

pub struct Entry {
    pub time: f64,
    pub seq: u64,
    pub ev: Ev,
}

#[derive(Default)]
pub struct Queue {
    /// sorted descending by (time, seq); the next event is at the end
    items: Vec<Entry>,
    next_seq: u64,
    trial_heap: bool,
}

impl Queue {
    /// Trial's pinned heap-js queue compares raw nanoseconds only. Equal-time events
    /// must follow its heap layout, including removal order, rather than insertion order.
    pub fn trial() -> Self { Self { trial_heap: true, ..Self::default() } }
    fn up(&mut self, mut i: usize) {
        while i > 0 {
            let p = (i - 1) / 2;
            if self.items[p].time <= self.items[i].time { break; }
            self.items.swap(p, i); i = p;
        }
    }
    fn down(&mut self, mut i: usize) {
        loop {
            let l = i * 2 + 1;
            if l >= self.items.len() { break; }
            let r = l + 1;
            let c = if r < self.items.len() && self.items[r].time < self.items[l].time { r } else { l };
            if self.items[i].time <= self.items[c].time { break; }
            self.items.swap(i, c); i = c;
        }
    }

    pub fn add(&mut self, time: f64, ev: Ev) {
        let _prof = crate::prof::start("queue.add");
        let time = if self.trial_heap { time } else { js::round(time / 1e3) * 1e3 };
        let seq = self.next_seq;
        self.next_seq += 1;
        if self.trial_heap {
            self.items.push(Entry { time, seq, ev }); self.up(self.items.len() - 1); return;
        }
        // first index whose key is smaller than (time, seq): new seq is the largest so far,
        // so equal-time entries already present sort after it in the pop order.
        let pos = self.items.partition_point(|e| e.time > time || (e.time == time && e.seq > seq));
        self.items.insert(pos, Entry { time, seq, ev });
    }

    #[inline]
    pub fn pop(&mut self) -> Option<Entry> {
        if !self.trial_heap { return self.items.pop(); }
        let last = self.items.pop()?;
        if self.items.is_empty() { return Some(last); }
        let root = std::mem::replace(&mut self.items[0], last);
        self.down(0); Some(root)
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.next_seq = 0;
    }

    #[inline]
    pub fn find<F: Fn(&Ev) -> bool>(&self, f: F) -> Option<&Ev> {
        self.items.iter().map(|e| &e.ev).find(|e| f(e))
    }

    #[inline]
    pub fn any<F: Fn(&Ev) -> bool>(&self, f: F) -> bool {
        self.items.iter().any(|e| f(&e.ev))
    }

    /// Removes all matching events; returns whether any was removed.
    #[inline]
    pub fn clear_matching<F: Fn(&Ev) -> bool>(&mut self, f: F) -> bool {
        let _prof = crate::prof::start("queue.clear_matching");
        let before = self.items.len();
        if self.trial_heap {
            let ids: Vec<u64> = self.items.iter().filter(|e| f(&e.ev)).map(|e| e.seq).collect();
            for id in ids {
                let i = self.items.iter().position(|e| e.seq == id).unwrap();
                if i == 0 { self.pop(); }
                else {
                    let last = self.items.pop().unwrap();
                    if i < self.items.len() { self.items[i] = last; self.up(i); self.down(i); }
                }
            }
        } else { self.items.retain(|e| !f(&e.ev)); }
        self.items.len() != before
    }

    pub fn clear_type(&mut self, t: EvType) -> bool {
        self.clear_matching(|e| e.ty() == t)
    }

    pub fn clear_for_unit(&mut self, u: UnitId) -> bool {
        self.clear_matching(|e| e.source() == Some(u) || e.target() == Some(u))
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }
}

#[cfg(test)]
mod trial_tests {
    use super::*;
    #[test]
    fn pinned_heap_js_equal_time_removal_order() {
        let mut q = Queue::trial();
        for source in 0..6 { q.add(1.12345, Ev::AutoAttack { source }); }
        q.clear_matching(|e| matches!(e, Ev::AutoAttack { source: 1 | 3 }));
        let mut order = vec![];
        while let Some(e) = q.pop() {
            assert_eq!(e.time, 1.12345); // Ordinary combat rounds time; trial must not.
            order.push(e.ev.source().unwrap());
        }
        assert_eq!(order, vec![0, 4, 2, 5]);
    }
    #[test]
    fn pinned_heap_js_multiple_removals() {
        let mut q = Queue::trial();
        for source in 0..8 { q.add((source % 3) as f64 + 0.0001 * source as f64, Ev::AutoAttack { source }); }
        q.clear_matching(|e| e.source().unwrap() % 2 == 0);
        let mut order = vec![];
        while let Some(e) = q.pop() { order.push(e.ev.source().unwrap()); }
        assert_eq!(order, vec![3, 1, 7, 5]);
    }
}
