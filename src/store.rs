use anyhow::Result;
use flate2::{Compression, read::GzDecoder, write::GzEncoder};
use rusqlite::{Connection, params};
use serde::{Serialize, de::DeserializeOwned};
use std::{
    io::{BufWriter, Read, Write},
    path::Path,
};
pub struct Store {
    db: Connection,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(30))?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,updated TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(kind,id));")?;
        Ok(Self { db })
    }
    pub fn finite_init(&self) -> Result<()> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS finite_candidates(job TEXT,stage INTEGER,candidate INTEGER,plan INTEGER,ordinal INTEGER,eph REAL,failure REAL,deaths REAL,dps REAL,professions INTEGER,metrics TEXT,run_id TEXT,profession_dps TEXT,PRIMARY KEY(job,stage,candidate));CREATE INDEX IF NOT EXISTS finite_rank ON finite_candidates(job,stage,eph DESC,failure,deaths,candidate);CREATE INDEX IF NOT EXISTS finite_dps ON finite_candidates(job,stage,dps DESC,candidate);")?;
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS finite_coffee(job TEXT,stage INTEGER,candidate INTEGER,json TEXT,PRIMARY KEY(job,stage,candidate));")?;
        Ok(())
    }
    pub fn finite_put(
        &self,
        job: &str,
        stage: u8,
        r: crate::finite::Ref,
        run: &crate::model::Run,
    ) -> Result<()> {
        let mask = run.configs.iter().fold(0u32, |m, c| {
            m | crate::model::CLASSES
                .iter()
                .position(|h| c["name"] == *h)
                .map(|i| 1 << i)
                .unwrap_or(0)
        });
        self.db.execute("INSERT OR REPLACE INTO finite_candidates VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![job,stage,r.candidate as i64,r.plan as i64,r.ordinal as i64,run.metrics.eph,run.metrics.failure,run.metrics.deaths,run.metrics.dps,mask,serde_json::to_string(&run.metrics)?,run.id,serde_json::to_string(&crate::model::CLASSES.iter().map(|c|crate::search::profession_dps(run,c)).collect::<Vec<_>>())?])?;
        let payload = serde_json::json!({"drinks":run.configs.iter().map(|c|c["drinks"].clone()).collect::<Vec<_>>(),"audit":run.result["coffeeAdjustment"],"food":run.configs.iter().map(|c|c["food"].clone()).collect::<Vec<_>>(),"foodAudit":run.result["foodAdjustment"]});
        self.db.execute(
            "INSERT OR REPLACE INTO finite_coffee VALUES(?1,?2,?3,?4)",
            params![
                job,
                stage,
                r.candidate as i64,
                serde_json::to_string(&payload)?
            ],
        )?;
        Ok(())
    }
    pub fn finite_coffee(
        &self,
        job: &str,
        stage: u8,
        candidate: usize,
    ) -> Result<Option<serde_json::Value>> {
        use rusqlite::OptionalExtension;
        let text: Option<String> = self
            .db
            .query_row(
                "SELECT json FROM finite_coffee WHERE job=? AND stage=? AND candidate=?",
                params![job, stage, candidate as i64],
                |r| r.get(0),
            )
            .optional()?;
        text.map(|t| Ok(serde_json::from_str(&t)?)).transpose()
    }
    pub fn finite_top(
        &self,
        job: &str,
        stage: u8,
        limit: usize,
        profession: Option<usize>,
        dps: bool,
        offset: usize,
    ) -> Result<Vec<(crate::finite::Ref, crate::model::Metrics, String)>> {
        self.finite_init()?;
        let order = if dps {
            if let Some(i) = profession {
                format!(
                    "json_extract(profession_dps,'$[{i}]') DESC,eph DESC,failure,deaths,candidate"
                )
            } else {
                "dps DESC,eph DESC,failure,deaths,candidate".into()
            }
        } else {
            "eph DESC,failure,deaths,candidate".into()
        };
        let sql = format!(
            "SELECT candidate,plan,ordinal,metrics,run_id FROM finite_candidates WHERE job=?1 AND stage=?2 AND (?3=0 OR (professions & ?3)!=0) ORDER BY {order} LIMIT ?4 OFFSET ?5"
        );
        let mut stmt = self.db.prepare(&sql)?;
        let mask = profession.map(|i| 1i64 << i).unwrap_or(0);
        let rows = stmt.query_map(
            params![
                job,
                stage,
                mask,
                limit.min(i64::MAX as usize) as i64,
                offset as i64
            ],
            |r| {
                Ok((
                    crate::finite::Ref {
                        candidate: r.get::<_, i64>(0)? as usize,
                        plan: r.get::<_, i64>(1)? as usize,
                        ordinal: r.get::<_, i64>(2)? as usize,
                    },
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )?;
        let mut out = vec![];
        for row in rows {
            let (r, m, id) = row?;
            out.push((r, serde_json::from_str(&m)?, id));
        }
        Ok(out)
    }
    pub fn finite_prepare_selection(
        &self,
        job: &str,
        stage: u8,
        previous: u8,
        limit: usize,
    ) -> Result<()> {
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS finite_selection(job TEXT,stage INTEGER,position INTEGER,candidate INTEGER,plan INTEGER,ordinal INTEGER,PRIMARY KEY(job,stage,position));")?;
        self.db.execute("INSERT OR REPLACE INTO finite_selection SELECT ?1,?2,ROW_NUMBER() OVER(ORDER BY eph DESC,failure,deaths,candidate)-1,candidate,plan,ordinal FROM finite_candidates WHERE job=?1 AND stage=?3 ORDER BY eph DESC,failure,deaths,candidate LIMIT ?4",params![job,stage,previous,limit as i64])?;
        Ok(())
    }
    pub fn finite_prepare_profession_selection(
        &self,
        job: &str,
        stage: u8,
        previous: u8,
        per_class: usize,
    ) -> Result<usize> {
        use std::collections::BTreeMap;
        let mut unique = BTreeMap::new();
        for i in 0..9 {
            for (r, m, _) in self.finite_top(job, previous, per_class, Some(i), false, 0)? {
                unique.entry(r.candidate).or_insert((r, m));
            }
        }
        let mut selected: Vec<_> = unique.into_values().collect();
        selected.sort_by(|(a, m), (b, n)| {
            n.eph
                .total_cmp(&m.eph)
                .then(m.failure.total_cmp(&n.failure))
                .then(m.deaths.total_cmp(&n.deaths))
                .then(a.candidate.cmp(&b.candidate))
        });
        self.db.execute_batch("CREATE TABLE IF NOT EXISTS finite_selection(job TEXT,stage INTEGER,position INTEGER,candidate INTEGER,plan INTEGER,ordinal INTEGER,PRIMARY KEY(job,stage,position));")?;
        for (i, (r, _)) in selected.iter().enumerate() {
            self.db.execute(
                "INSERT OR REPLACE INTO finite_selection VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    job,
                    stage,
                    i as i64,
                    r.candidate as i64,
                    r.plan as i64,
                    r.ordinal as i64
                ],
            )?;
        }
        Ok(selected.len())
    }
    pub fn finite_reference(
        &self,
        job: &str,
        stage: u8,
        index: usize,
    ) -> Result<crate::finite::Ref> {
        Ok(self.db.query_row("SELECT candidate,plan,ordinal FROM finite_selection WHERE job=? AND stage=? AND position=?",params![job,stage,index as i64],|r|Ok(crate::finite::Ref{candidate:r.get::<_,i64>(0)?as usize,plan:r.get::<_,i64>(1)?as usize,ordinal:r.get::<_,i64>(2)?as usize}))?)
    }
    pub fn finite_select(
        &self,
        job: &str,
        stage: u8,
        limit: usize,
    ) -> Result<Vec<crate::finite::Ref>> {
        let mut stmt=self.db.prepare("SELECT candidate,plan,ordinal FROM finite_candidates WHERE job=?1 AND stage=?2 ORDER BY eph DESC,failure,deaths,candidate LIMIT ?3")?;
        let rows = stmt.query_map(params![job, stage, limit as i64], |r| {
            Ok(crate::finite::Ref {
                candidate: r.get::<_, i64>(0)? as usize,
                plan: r.get::<_, i64>(1)? as usize,
                ordinal: r.get::<_, i64>(2)? as usize,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn finite_count(&self, job: &str, stage: u8, profession: Option<usize>) -> Result<usize> {
        self.finite_init()?;
        let mask = profession.map(|i| 1i64 << i).unwrap_or(0);
        Ok(self.db.query_row("SELECT COUNT(*) FROM finite_candidates WHERE job=? AND stage=? AND (?=0 OR (professions & ?)!=0)",params![job,stage,mask,mask],|r|r.get::<_,i64>(0))? as usize)
    }
    pub fn put(&self, kind: &str, id: &str, value: &impl Serialize) -> Result<()> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        {
            let mut writer = BufWriter::new(&mut encoder);
            serde_json::to_writer(&mut writer, value)?;
            writer.flush()?;
        }
        let encoded = format!("gzip:{}", hex::encode(encoder.finish()?));
        self.db.execute(
            "INSERT OR REPLACE INTO records(kind,id,json) VALUES(?1,?2,?3)",
            params![kind, id, encoded],
        )?;
        Ok(())
    }
    pub fn get<T: DeserializeOwned>(&self, kind: &str, id: &str) -> Result<Option<T>> {
        use rusqlite::OptionalExtension;
        let text: Option<String> = self
            .db
            .query_row(
                "SELECT json FROM records WHERE kind=?1 AND id=?2",
                [kind, id],
                |r| r.get(0),
            )
            .optional()?;
        text.map(|t| decode(&t)).transpose()
    }
    pub fn list_recent<T: DeserializeOwned>(&self, kind: &str, limit: usize) -> Result<Vec<T>> {
        let mut stmt = self.db.prepare(
            "SELECT json FROM records WHERE kind=? ORDER BY updated DESC,rowid DESC LIMIT ?",
        )?;
        let rows = stmt.query_map(params![kind, limit as i64], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for r in rows {
            out.push(decode(&r?)?);
        }
        Ok(out)
    }
    pub fn record_stamps(&self, kind: &str) -> Result<Vec<(String, String)>> {
        let mut stmt = self.db.prepare(
            "SELECT id,updated || ':' || rowid FROM records WHERE kind=? ORDER BY updated,rowid",
        )?;
        let rows = stmt.query_map([kind], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
    pub fn list<T: DeserializeOwned>(&self, kind: &str) -> Result<Vec<T>> {
        let mut stmt = self
            .db
            .prepare("SELECT json FROM records WHERE kind=? ORDER BY updated DESC,rowid DESC")?;
        let rows = stmt.query_map([kind], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for r in rows {
            let text = r?;
            if let Some(compressed) = text.strip_prefix("gzip:") {
                let bytes = hex::decode(compressed)?;
                let mut decoder = GzDecoder::new(bytes.as_slice());
                let mut json = Vec::new();
                decoder.read_to_end(&mut json)?;
                out.push(serde_json::from_slice(&json)?);
            } else {
                out.push(serde_json::from_str(&text)?)
            }
        }
        Ok(out)
    }
}

fn decode<T: DeserializeOwned>(text: &str) -> Result<T> {
    if let Some(compressed) = text.strip_prefix("gzip:") {
        let bytes = hex::decode(compressed)?;
        let mut decoder = GzDecoder::new(bytes.as_slice());
        let mut data = Vec::new();
        decoder.read_to_end(&mut data)?;
        Ok(serde_json::from_slice(&data)?)
    } else {
        Ok(serde_json::from_str(text)?)
    }
}
