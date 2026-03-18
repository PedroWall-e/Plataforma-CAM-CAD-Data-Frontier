// lib.rs — Tauri v2 · Phase 2+: shape store + transformations (refatorado)

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
    fn clone_shape_c    (shape_id: i32, out: *mut OcctMesh) -> i32;

    // Booleanos (resultado em idA; idB é removido do store)
    fn boolean_union_c    (id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;
    fn boolean_cut_c      (id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;
    fn boolean_intersect_c(id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;

    // Fillet & Chamfer (todas as arestas)
    fn fillet_all_c (shape_id: i32, radius: f32, out: *mut OcctMesh) -> i32;
    fn chamfer_all_c(shape_id: i32, dist:   f32, out: *mut OcctMesh) -> i32;

    // Shell (casca oca)
    fn shell_c(shape_id: i32, thickness: f32, out: *mut OcctMesh) -> i32;

    // Export
    fn export_stl_c (shape_id: i32, path: *const std::ffi::c_char) -> i32;
    fn export_step_c(shape_id: i32, path: *const std::ffi::c_char) -> i32;

    fn free_occt_mesh(mesh: *mut OcctMesh);
}

// ─── Domain types ─────────────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct MeshData { pub vertices: Vec<f32>, pub indices: Vec<u32> }

#[derive(Serialize)]
pub struct ShapeMesh { pub shape_id: i32, pub mesh: MeshData }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Coleta os dados de um OcctMesh retornado pelo C++.
///
/// # Safety
/// Valida explicitamente ponteiros e contagens antes de usar `slice::from_raw_parts`,
/// retornando `Err` em vez de causar Undefined Behavior se o C++ retornar dados inválidos.
unsafe fn collect_mesh(raw: &mut OcctMesh) -> Result<MeshData, String> {
    // Guarda de memory safety: rejeita contagens inválidas antes de qualquer unsafe.
    if raw.vertex_count < 0 || raw.index_count < 0 {
        free_occt_mesh(raw);
        return Err(format!(
            "Contagens inválidas do C++ (vertices={}, indices={})",
            raw.vertex_count, raw.index_count
        ));
    }

    let vertices = if raw.vertices.is_null() || raw.vertex_count == 0 {
        vec![]
    } else {
        // Safety: ponteiro não-nulo, contagem positiva validada acima.
        std::slice::from_raw_parts(raw.vertices, raw.vertex_count as usize).to_vec()
    };

    let indices = if raw.indices.is_null() || raw.index_count == 0 {
        vec![]
    } else {
        // Safety: ponteiro não-nulo, contagem positiva validada acima.
        std::slice::from_raw_parts(raw.indices, raw.index_count as usize).to_vec()
    };

    free_occt_mesh(raw);

    if vertices.is_empty() {
        Err("Tesselação vazia — shape pode ser degenerado".into())
    } else {
        Ok(MeshData { vertices, indices })
    }
}

fn validate_positive(vals: &[f64], names: &str) -> Result<(), String> {
    if vals.iter().any(|&v| v <= 0.0) {
        Err(format!("{} devem ser > 0", names))
    } else {
        Ok(())
    }
}

// ─── Commands: Create ─────────────────────────────────────────────────────────

#[tauri::command]
fn create_box(width: f64, height: f64, depth: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[width, height, depth], "width, height, depth")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_box_c(width, height, depth, &mut raw);
        if id < 0 { return Err("Falha ao criar box no kernel OCCT".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

#[tauri::command]
fn create_cylinder(radius: f64, height: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[radius, height], "radius, height")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_cylinder_c(radius, height, &mut raw);
        if id < 0 { return Err("Falha ao criar cylinder no kernel OCCT".into()); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

#[tauri::command]
fn create_sphere(radius: f64) -> Result<ShapeMesh, String> {
    validate_positive(&[radius], "radius")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_sphere_c(radius, &mut raw);
        if id < 0 { return Err("Falha ao criar sphere no kernel OCCT".into()); }
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
        if id < 0 { return Err("Falha ao criar cone no kernel OCCT".into()); }
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
        if id < 0 {
            return Err(format!("Shape ID {} não encontrado na store ou transformação falhou", shape_id));
        }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Remove o shape da store C++.
#[tauri::command]
fn delete_shape(shape_id: i32) {
    unsafe { remove_shape_c(shape_id); }
}

/// Duplica o shape na store e devolve ShapeMesh com novo ID.
#[tauri::command]
fn clone_shape(shape_id: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = clone_shape_c(shape_id, &mut raw);
        if id < 0 {
            return Err(format!("Falha ao clonar shape {}", shape_id));
        }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

// ─── Operações Booleanas ──────────────────────────────────────────────────────

/// Union: A ∪ B → resultado substitui A, B é removido. Devolve ShapeMesh de A.
#[tauri::command]
fn boolean_union(id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_union_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_union falhou (A={}, B={})", id_a, id_b)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Cut: A − B → resultado substitui A, B é removido. Devolve ShapeMesh de A.
#[tauri::command]
fn boolean_cut(id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_cut_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_cut falhou (A={}, B={})", id_a, id_b)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Intersect: A ∩ B → resultado substitui A, B é removido. Devolve ShapeMesh de A.
#[tauri::command]
fn boolean_intersect(id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_intersect_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_intersect falhou (A={}, B={})", id_a, id_b)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

// ─── Fillet & Chamfer ─────────────────────────────────────────────────────────

/// Arredonda todas as arestas do shape com o raio dado.
#[tauri::command]
fn fillet_shape(shape_id: i32, radius: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = fillet_all_c(shape_id, radius, &mut raw);
        if id < 0 { return Err(format!("fillet_shape falhou (id={}, r={})", shape_id, radius)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Chanfra todas as arestas do shape com a distância dada.
#[tauri::command]
fn chamfer_shape(shape_id: i32, dist: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = chamfer_all_c(shape_id, dist, &mut raw);
        if id < 0 { return Err(format!("chamfer_shape falhou (id={}, d={})", shape_id, dist)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Cria casca oca (remove face superior, aplica espessura inward).
#[tauri::command]
fn shell_shape(shape_id: i32, thickness: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = shell_c(shape_id, thickness, &mut raw);
        if id < 0 { return Err(format!("shell_shape falhou (id={}, t={})", shape_id, thickness)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Exporta shape como STL no caminho especificado.
#[tauri::command]
fn export_stl(shape_id: i32, path: String) -> Result<(), String> {
    use std::ffi::CString;
    let c_path = CString::new(path.as_str()).map_err(|e| e.to_string())?;
    let ok = unsafe { export_stl_c(shape_id, c_path.as_ptr()) };
    if ok < 0 { Err(format!("export_stl falhou para shape {}", shape_id)) } else { Ok(()) }
}

/// Exporta shape como STEP no caminho especificado.
#[tauri::command]
fn export_step(shape_id: i32, path: String) -> Result<(), String> {
    use std::ffi::CString;
    let c_path = CString::new(path.as_str()).map_err(|e| e.to_string())?;
    let ok = unsafe { export_step_c(shape_id, c_path.as_ptr()) };
    if ok < 0 { Err(format!("export_step falhou para shape {}", shape_id)) } else { Ok(()) }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_box, create_cylinder, create_sphere, create_cone,
            transform_shape, delete_shape, clone_shape,
            boolean_union, boolean_cut, boolean_intersect,
            fillet_shape, chamfer_shape, shell_shape,
            export_stl, export_step,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação Tauri");
}
