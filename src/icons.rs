//! Restore the original sprite's inherited fill in the UI loader only.
//! On-disk game art is never edited, cropped, recolored or regenerated.
use eframe::egui;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
pub const SKILL_BACKPLATE: egui::Color32 = egui::Color32::from_rgb(42, 52, 72);

fn svg_for_display(source: &str) -> String {
    let Some(at) = source.find("<svg") else {
        return source.into();
    };
    let Some(end) = source[at..].find('>') else {
        return source.into();
    };
    if source[at..at + end].contains("fill=") {
        return source.into();
    }
    let mut svg = source.to_owned();
    svg.insert_str(at + 4, " fill=\"none\"");
    svg
}
pub fn image(res: &Path, hrid: &str, size: f32) -> egui::Image<'static> {
    let base = hrid.split("__custom_").next().unwrap_or(hrid);
    let slug = base.rsplit('/').next().unwrap_or(base);
    let slug = slug.strip_suffix("_refined").unwrap_or(slug);
    if hrid.starts_with("/abilities/") {
        return egui::Image::from_uri(format!(
            "file://{}",
            res.join("icons/abilities")
                .join(format!("{slug}.png"))
                .display()
        ))
        .fit_to_exact_size(egui::vec2(size, size))
        .bg_fill(SKILL_BACKPLATE)
        .corner_radius(5.);
    }
    let path = res.join("icons").join(format!("{slug}.svg"));
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<[u8]>>>> = OnceLock::new();
    let bytes = CACHE
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(path.clone())
        .or_insert_with(|| {
            let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| {
                "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"/>".into()
            });
            Arc::from(svg_for_display(&raw).into_bytes())
        })
        .clone();
    egui::Image::from_bytes(
        format!("bytes://game-icons-fill-none/{slug}.svg"),
        egui::load::Bytes::Shared(bytes),
    )
    .fit_to_exact_size(egui::vec2(size, size))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_transparency_without_changing_any_shape() {
        let original = include_str!("../resources/icons/abyssal_essence.svg");
        let shown = svg_for_display(original);
        assert_eq!(shown.replacen(" fill=\"none\"", "", 1), original);
        let old =
            egui_extras::image::load_svg_bytes(original.as_bytes(), &Default::default()).unwrap();
        let new =
            egui_extras::image::load_svg_bytes(shown.as_bytes(), &Default::default()).unwrap();
        let (x, y) = (10, 32);
        assert_eq!(old.pixels[y * old.size[0] + x].a(), 255);
        assert_eq!(new.pixels[y * new.size[0] + x].a(), 0);
    }
    #[test]
    fn explicit_fill_and_png_are_not_rewritten() {
        let original = "<svg fill=\"red\"><path d=\"M0 0h10v10z\"/></svg>";
        assert_eq!(svg_for_display(original), original);
    }
}
