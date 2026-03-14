// lib.rs — Tauri v2 · Phase 2: shape store + transformations

use serde::Serialize;

// ─── FFI ──────────────────────────────────────────────────────────────────────
#[repr(C)]
struct OcctMesh {
    vertices: *mut f32, vertex_count: i32,
    indices:  *mut u32, index_count:  i32,
}

impl OcctMesh {
    fn empty() -> Self {
        Self { vertices: std::ptr::null_mut(), vertex_count: 0,
               indices:  std::ptr::null_mut(), index_count:  0 }
    }
}

unsafe extern "C" {
    // Create (store + mesh)
    fn create_box_c     (w: f64, h: f64, d: f64, out: *mut OcctMesh) -> i32;
    fn create_cylinder_c(radius: f64, height: f64, out: *mut OcctMesh) -> i32;
    fn create_sphere_c  (radius: f64, out: *mut OcctMesh) -> i32;
    fn create_cone_c    (rb: f64, rt: f64, height: f64, out: *mut OcctMesh) -> i32;

    // Transform
    fn transform_shape_c(shape_id: i32, matrix16: *const f32, out: *mut OcctMesh) -> i32;
    fn remove_shape_c   (shape_id: i32);

    fn free_occt_mesh(mesh: *mut OcctMesh);
}

// ─── Domain types ─────────────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct MeshData { pub vertices: Vec<f32>, pub indices: Vec<u32> }

#[derive(Serialize)]
pub struct ShapeMesh { pub shape_id: i32, pub mesh: MeshData }

// ─── Helpers ──────────────────────────────────────────────────────────────────
unsafe fn collect_mesh(raw: &mut OcctMesh) -> Result<MeshData, String> {
    let vertices = if raw.vertices.is_null() || raw.vertex_count == 0 { vec![] }
        else { std::slice::from_raw_parts(raw.vertices, raw.vertex_count as usize).to_vec() };
    let indices  = if raw.indices.is_null()  || raw.index_count  == 0 { vec![] }
        else { std::slice::from_raw_parts(raw.indices,  raw.index_count  as usize).to_vec() };
    free_occt_mesh(raw);
    if vertices.is_empty() { Err("Tessela vazia".into()) } else { Ok(MeshData { vertices, indices }) }
}

fn validate_positive(vals: &[f64], names: &str) -> Result<(), String> {
    if vals.iter().any(|&v| v <= 0.0) {
        Err(format!("{} devem ser > 0", names))
    } else { Ok(()) }
}

// ─── Commands: Create ─────────────────────────────────────────────────────────

#[tauri::command]
fn create_box(width: f64, height: f64, depth: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[width, height, depth], "width, height, depth")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_box_c(width, height, depth, &mut raw);
        if id < 0 { return Err("Falha ao criar box".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

#[tauri::command]
fn create_cylinder(radius: f64, height: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[radius, height], "radius, height")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_cylinder_c(radius, height, &mut raw);
        if id < 0 { return Err("Falha ao criar cylinder".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

#[tauri::command]
fn create_sphere(radius: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[radius], "radius")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_sphere_c(radius, &mut raw);
        if id < 0 { return Err("Falha ao criar sphere".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

#[tauri::command]
fn create_cone(radius_bottom: f64, radius_top: f64, height: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[radius_bottom, height], "radius_bottom, height")?;
    if radius_top < 0.0 { return Err("radius_top não pode ser negativo".into()); }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_cone_c(radius_bottom, radius_top, height, &mut raw);
        if id < 0 { return Err("Falha ao criar cone".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

// ─── Commands: Transform ──────────────────────────────────────────────────────

/// Aplica a matriz 4×4 (16 floats, coluna-major Three.js) ao shape armazenado.
#[tauri::command]
fn transform_shape(shape_id: i32, matrix: Vec<f32>) -> Result<ShapeMesh, String> {
    if matrix.len() != 16 {
        return Err(format!("matrix deve ter 16 elementos, recebidos: {}", matrix.len()));
    }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = transform_shape_c(shape_id, matrix.as_ptr(), &mut raw);
        if id < 0 { return Err(format!("Shape ID {} não encontrado na store", shape_id)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Remove o shape da store C++.
#[tauri::command]
fn delete_shape(shape_id: i32) {
    unsafe { remove_shape_c(shape_id); }
}

// ── Legacy commands (sem store – mantém compat com generate_box antigo) ───────
#[tauri::command]
fn generate_box(width: f64, height: f64, depth: f64) -> Result<MeshData, String> {
    create_box(width, height, depth).map(|s| s.mesh)
}
#[tauri::command]
fn generate_cylinder(radius: f64, height: f64) -> Result<MeshData, String> {
    create_cylinder(radius, height).map(|s| s.mesh)
}
#[tauri::command]
fn generate_sphere(radius: f64) -> Result<MeshData, String> {
    create_sphere(radius).map(|s| s.mesh)
}
#[tauri::command]
fn generate_cone(radius_bottom: f64, radius_top: f64, height: f64) -> Result<MeshData, String> {
    create_cone(radius_bottom, radius_top, height).map(|s| s.mesh)
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_box, create_cylinder, create_sphere, create_cone,
            transform_shape, delete_shape,
            generate_box, generate_cylinder, generate_sphere, generate_cone,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação Tauri");
}
