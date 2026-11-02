//! Guild trial rules, pinned separately from ordinary combat.
use serde_json::{Value, json};

pub struct Trial {
    pub monsters: Vec<String>,
    pub participants: usize,
    pub floor: u32,
    pub level: u32,
    pub completed: u32,
    pub started: f64,
    pub floors: Vec<Value>,
    pub ended: bool,
    pub failure: Option<f64>,
}
impl Trial {
    pub fn new(v: &Value, participants: usize) -> Result<Self, String> {
        let monsters: Vec<String> = v.get("monsterHrids").and_then(Value::as_array)
            .ok_or("trial requires monsters")?.iter().map(|s| s.as_str().map(str::to_owned).ok_or("invalid trial monster".to_string())).collect::<Result<_,_>>()?;
        if monsters.is_empty() || !(1..=100).contains(&participants) { return Err("invalid trial roster".into()); }
        Ok(Self { monsters, participants, floor: 1, level: 100, completed: 0, started: 0.0, floors: vec![], ended: false, failure: None })
    }
    pub fn complete(&mut self, time: f64) -> bool {
        self.floors.push(json!({"floor":self.floor,"startedAt":self.started,"completedAt":time,"duration":time-self.started}));
        self.completed = self.floor;
        if self.level >= 300 { self.ended = true; false }
        else { self.floor += 1; self.level += 10; true }
    }
    pub fn fail(&mut self, time: f64) { self.failure = Some(time); self.ended = true; }
    pub fn json(&self) -> Value {
        json!({"completedFloor":self.completed,"currentFloor":self.floor,"currentLevel":self.level,
            "startLevel":100,"maxLevel":300,"participantCount":self.participants,"hitpointMultiplier":1.0+self.participants as f64*0.01,
            "points":if self.completed > 0 {400+(self.completed-1)*200} else {0},
            "failed":self.failure.is_some(),"failureTime":self.failure,
            "endedReason":if self.failure.is_some() {"party_wiped"} else if self.ended {"max_level_completed"} else {"time_limit"},
            "floorResults":self.floors})
    }
}
