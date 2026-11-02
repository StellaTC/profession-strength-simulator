use eframe::egui;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        OnceLock, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};
static EN: AtomicBool = AtomicBool::new(false);
static DICT: OnceLock<RwLock<BTreeMap<String, String>>> = OnceLock::new();
pub fn english() -> bool {
    EN.load(Ordering::Relaxed)
}
pub fn set_english(en: bool) {
    EN.store(en, Ordering::Relaxed);
}
pub fn register(catalog: &Value) {
    let mut map = DICT.get_or_init(Default::default).write().unwrap();
    for field in ["items", "abilities", "monsters", "zones"] {
        let values: Vec<_> = if let Some(a) = catalog[field].as_array() {
            a.iter().collect()
        } else {
            catalog[field]
                .as_object()
                .into_iter()
                .flat_map(|m| m.values())
                .collect()
        };
        for v in values {
            if let (Some(zh), Some(en)) = (v["name"].as_str(), v["englishName"].as_str()) {
                map.insert(zh.into(), en.into());
            }
        }
    }
}
pub fn register_user_name(name: &str) {
    DICT.get_or_init(Default::default)
        .write()
        .unwrap()
        .insert(name.into(), name.into());
}
pub fn tr(input: impl Into<egui::WidgetText>) -> egui::RichText {
    let input = input.into();
    let output = if english() {
        text(input.text())
    } else {
        decimals(input.text())
    };
    if output == input.text() {
        if let egui::WidgetText::RichText(t) = input {
            return (*t).clone();
        }
    }
    egui::RichText::new(output)
}
pub fn text(input: &str) -> String {
    static CACHE: OnceLock<RwLock<std::collections::HashMap<String, String>>> = OnceLock::new();
    if english() {
        if let Some(value) = DICT
            .get_or_init(Default::default)
            .read()
            .unwrap()
            .get(input)
        {
            return value.clone();
        }
        if let Some(s) = CACHE
            .get_or_init(Default::default)
            .read()
            .unwrap()
            .get(input)
        {
            return s.clone();
        }
    }
    let mut value = decimals(input);
    if !english() {
        return value;
    }
    let mut pairs: Vec<(String, String)> = include_str!("../resources/ui-english.tsv")
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(a, b)| (a.replace("\\n", "\n"), b.replace("\\n", "\n")))
        .collect();
    if let Ok(map) = DICT.get_or_init(Default::default).read() {
        pairs.extend(map.iter().map(|(a, b)| (a.clone(), b.clone())));
    }
    pairs.sort_by_key(|(a, _)| std::cmp::Reverse(a.len()));
    // Match once against source text: replacement words are never translated again.
    let mut out = String::new();
    while !value.is_empty() {
        if let Some((a, b)) = pairs.iter().find(|(a, _)| value.starts_with(a.as_str())) {
            out.push_str(b);
            value.drain(..a.len());
        } else {
            let c = value.chars().next().unwrap();
            out.push(c);
            value.drain(..c.len_utf8());
        }
    }
    if let Ok(mut cache) = CACHE.get_or_init(Default::default).write() {
        if cache.len() > 8192 {
            cache.clear();
        }
        cache.insert(input.into(), out.clone());
    }
    out
}
fn decimals(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < chars.len() && chars[i] == '.' && chars[i + 1].is_ascii_digit() {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                let raw: String = chars[start..i].iter().collect();
                if let Ok(v) = raw.parse::<f64>() {
                    out.push_str(&lineup_simulator::workflow::number(v));
                } else {
                    out.push_str(&raw);
                }
            } else {
                out.extend(chars[start..i].iter());
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimal_display() {
        assert_eq!(
            decimals("EPH 10.00 DPS 12.50 ± 1.235"),
            "EPH 10 DPS 12.5 ± 1.24"
        );
    }
}
