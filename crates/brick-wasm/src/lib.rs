//! WebAssembly bindings: parse a GLB once, then re-brickify cheaply as options change.

use brick_core::{BrickModel, Mesh, Options, export};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    mesh: Mesh,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(glb: &[u8]) -> Result<Engine, JsError> {
        console_error_panic_hook::set_once();
        Ok(Engine { mesh: brick_core::load_glb(glb)? })
    }

    #[wasm_bindgen(js_name = triangleCount)]
    pub fn triangle_count(&self) -> usize {
        self.mesh.triangles.len()
    }

    /// `options` is a JSON `Options` object (camelCase, all fields optional); returns `BrickModel` JSON.
    pub fn brickify(&self, options: &str) -> Result<String, JsError> {
        let opts: Options = serde_json::from_str(options)?;
        Ok(serde_json::to_string(&brick_core::brickify(&self.mesh, &opts))?)
    }
}

#[wasm_bindgen(js_name = toLdraw)]
pub fn to_ldraw(model: &str, name: &str) -> Result<String, JsError> {
    let model: BrickModel = serde_json::from_str(model)?;
    Ok(export::to_ldraw(&model, name))
}

#[wasm_bindgen(js_name = bomCsv)]
pub fn bom_csv(model: &str) -> Result<String, JsError> {
    let model: BrickModel = serde_json::from_str(model)?;
    Ok(export::bom_csv(&model))
}
