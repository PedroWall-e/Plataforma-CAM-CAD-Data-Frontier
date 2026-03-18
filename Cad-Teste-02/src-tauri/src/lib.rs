// lib.rs — Tauri v2 · Phase 4: Sketching 2D (Workplane + Extrude + Revolve + Clipper2)

mod graph;
use graph::{CadGraph, CadOp};
use serde::Serialize;
use std::sync::Mutex;

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
    fn create_box_c     (w: f64, h: f64, d: f64, out: *mut OcctMesh) -> i32;
    fn create_cylinder_c(radius: f64, height: f64, out: *mut OcctMesh) -> i32;
    fn create_sphere_c  (radius: f64, out: *mut OcctMesh) -> i32;
    fn create_cone_c    (rb: f64, rt: f64, height: f64, out: *mut OcctMesh) -> i32;

    fn transform_shape_c(shape_id: i32, matrix16: *const f32, out: *mut OcctMesh) -> i32;
    fn remove_shape_c   (shape_id: i32);
    fn clone_shape_c    (shape_id: i32, out: *mut OcctMesh) -> i32;

    fn boolean_union_c    (id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;
    fn boolean_cut_c      (id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;
    fn boolean_intersect_c(id_a: i32, id_b: i32, out: *mut OcctMesh) -> i32;

    fn fillet_all_c (shape_id: i32, radius: f32, out: *mut OcctMesh) -> i32;
    fn chamfer_all_c(shape_id: i32, dist:   f32, out: *mut OcctMesh) -> i32;

    fn shell_c(shape_id: i32, thickness: f32, out: *mut OcctMesh) -> i32;

    fn export_stl_c (shape_id: i32, path: *const std::ffi::c_char) -> i32;
    fn export_step_c(shape_id: i32, path: *const std::ffi::c_char) -> i32;

    // Edge selection (Fase 3.1+)
    fn get_edge_count_c    (shape_id: i32) -> i32;
    fn get_edge_midpoints_c(shape_id: i32, out_xyz: *mut f32, max_edges: i32) -> i32;
    fn fillet_edges_c (shape_id: i32, edge_ids: *const i32, n: i32, radius: f32, out: *mut OcctMesh) -> i32;
    fn chamfer_edges_c(shape_id: i32, edge_ids: *const i32, n: i32, dist:   f32, out: *mut OcctMesh) -> i32;

    // Undo / Redo (Opção B — stack no backend C++)
    fn undo_depth_c(shape_id: i32) -> i32;
    fn redo_depth_c(shape_id: i32) -> i32;
    fn undo_shape_c(shape_id: i32, out: *mut OcctMesh) -> i32;
    fn redo_shape_c(shape_id: i32, out: *mut OcctMesh) -> i32;

    fn free_occt_mesh(mesh: *mut OcctMesh);

    // ── Fase 4: Workplane + Extrude + Revolve (OCCT) ─────────────────────────
    /// Retorna informações do plano de uma face: origin[3], normal[3], u_axis[3], v_axis[3]
    fn get_face_plane_c(shape_id: i32, face_index: i32, out_f32: *mut f32) -> i32;
    /// Extrude um perfil 2D dado pelo plano world e array de pontos (u,v)
    fn extrude_profile_c(
        xy: *const f32, n_pts: i32,
        plane_mat16: *const f32,
        depth: f32,
        fuse_with: i32,      // -1 = novo shape, ≥0 = funde com esse shape_id
        out: *mut OcctMesh,
    ) -> i32;
    /// Revolve um perfil 2D em torno de um eixo
    fn revolve_profile_c(
        xy: *const f32, n_pts: i32,
        plane_mat16: *const f32,
        axis_xyz: *const f32,  // 3 floats: direção do eixo
        angle_deg: f32,
        fuse_with: i32,
        out: *mut OcctMesh,
    ) -> i32;
}

// ─── FFI: Sketch bridge (Clipper2 + CavalierContours) ───────────────────────
#[repr(C)]
struct SketchResult {
    points:        *mut f32,
    point_counts:  *mut i32,
    contour_count: i32,
    total_points:  i32,
}

impl SketchResult {
    fn empty() -> Self {
        Self {
            points: std::ptr::null_mut(),
            point_counts: std::ptr::null_mut(),
            contour_count: 0,
            total_points: 0,
        }
    }
}

unsafe extern "C" {
    fn sketch_boolean_c(
        a_xy: *const f32, a_n: i32,
        b_xy: *const f32, b_n: i32,
        op: i32,
        out: *mut SketchResult,
    ) -> i32;

    fn sketch_offset_segments_c(
        xy: *const f32, n: i32,
        offset: f32,
        closed: i32,
        out: *mut SketchResult,
    ) -> i32;

    fn sketch_offset_arcs_c(
        xy: *const f32, n: i32,
        bulges: *const f32,   // null = todos retos
        offset: f32,
        out: *mut SketchResult,
    ) -> i32;

    fn free_sketch_result(r: *mut SketchResult);
}

// ─── Domain types ─────────────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct MeshData { pub vertices: Vec<f32>, pub indices: Vec<u32> }

#[derive(Serialize)]
pub struct ShapeMesh { pub shape_id: i32, pub mesh: MeshData }

// ─── Helpers ──────────────────────────────────────────────────────────────────
unsafe fn collect_mesh(raw: &mut OcctMesh) -> Result<MeshData, String> {
    if raw.vertex_count < 0 || raw.index_count < 0 {
        free_occt_mesh(raw);
        return Err(format!("Contagens inválidas do C++ (v={}, i={})", raw.vertex_count, raw.index_count));
    }
    let vertices = if raw.vertices.is_null() || raw.vertex_count == 0 { vec![] }
        else { std::slice::from_raw_parts(raw.vertices, raw.vertex_count as usize).to_vec() };
    let indices = if raw.indices.is_null() || raw.index_count == 0 { vec![] }
        else { std::slice::from_raw_parts(raw.indices, raw.index_count as usize).to_vec() };
    free_occt_mesh(raw);
    if vertices.is_empty() { Err("Tesselação vazia — shape degenerado".into()) }
    else { Ok(MeshData { vertices, indices }) }
}

fn validate_positive(vals: &[f64], names: &str) -> Result<(), String> {
    if vals.iter().any(|&v| v <= 0.0) { Err(format!("{} devem ser > 0", names)) }
    else { Ok(()) }
}

// ─── Estado global do DAG ─────────────────────────────────────────────────────
pub struct AppState {
    pub graph: Mutex<CadGraph>,
}

// ─── Commands: Create ─────────────────────────────────────────────────────────

#[tauri::command]
fn create_box(
    state: tauri::State<AppState>,
    width: f64, height: f64, depth: f64,
) -> Result<ShapeMesh, String> {
    validate_positive(&[width, height, depth], "width, height, depth")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_box_c(width, height, depth, &mut raw);
        if id < 0 { return Err("Falha ao criar box no kernel OCCT".into()); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Caixa {:.0}×{:.0}×{:.0}", width, height, depth);
        let op = CadOp::Box { width: width as f32, height: height as f32, depth: depth as f32 };
        state.graph.lock().unwrap().add_node(&label, op, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn create_cylinder(
    state: tauri::State<AppState>,
    radius: f64, height: f64,
) -> Result<ShapeMesh, String> {
    validate_positive(&[radius, height], "radius, height")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_cylinder_c(radius, height, &mut raw);
        if id < 0 { return Err("Falha ao criar cylinder".into()); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Cilindro R{:.0} H{:.0}", radius, height);
        let op = CadOp::Cylinder { radius: radius as f32, height: height as f32 };
        state.graph.lock().unwrap().add_node(&label, op, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn create_sphere(
    state: tauri::State<AppState>,
    radius: f64,
) -> Result<ShapeMesh, String> {
    validate_positive(&[radius], "radius")?;
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_sphere_c(radius, &mut raw);
        if id < 0 { return Err("Falha ao criar sphere".into()); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Esfera R{:.0}", radius);
        let op = CadOp::Sphere { radius: radius as f32 };
        state.graph.lock().unwrap().add_node(&label, op, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn create_cone(
    state: tauri::State<AppState>,
    radius_bottom: f64, radius_top: f64, height: f64,
) -> Result<ShapeMesh, String> {
    validate_positive(&[radius_bottom, height], "radius_bottom, height")?;
    if radius_top < 0.0 { return Err("radius_top não pode ser negativo".into()); }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = create_cone_c(radius_bottom, radius_top, height, &mut raw);
        if id < 0 { return Err("Falha ao criar cone".into()); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Cone Rb{:.0} Rt{:.0} H{:.0}", radius_bottom, radius_top, height);
        let op = CadOp::Cone { radius_bottom: radius_bottom as f32, radius_top: radius_top as f32, height: height as f32 };
        state.graph.lock().unwrap().add_node(&label, op, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

// ─── Commands: Transform / Clone / Delete ─────────────────────────────────────

#[tauri::command]
fn transform_shape(
    state: tauri::State<AppState>,
    shape_id: i32, matrix: Vec<f32>,
) -> Result<ShapeMesh, String> {
    if matrix.len() != 16 { return Err(format!("matrix deve ter 16 elementos")); }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = transform_shape_c(shape_id, matrix.as_ptr(), &mut raw);
        if id < 0 { return Err(format!("Shape {} não encontrado ou transform falhou", shape_id)); }
        let mesh = collect_mesh(&mut raw)?;
        // Registra ou atualiza nó de transform no grafo
        {
            let g = state.graph.lock().unwrap();
            // Se já existe o shape como primitiva/outra op, adiciona nó de transform
            // (conservador: não sobrescreve a op original, apenas adiciona transform)
            let _ = g.node_by_shape_id(shape_id); // consulta silenciosa — transform não cria novo nó de shape
        }
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn delete_shape(state: tauri::State<AppState>, shape_id: i32) {
    state.graph.lock().unwrap().remove_by_shape_id(shape_id);
    unsafe { remove_shape_c(shape_id); }
}

#[tauri::command]
fn clone_shape(
    state: tauri::State<AppState>,
    shape_id: i32,
) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = clone_shape_c(shape_id, &mut raw);
        if id < 0 { return Err(format!("Falha ao clonar shape {}", shape_id)); }
        let mesh = collect_mesh(&mut raw)?;
        let label = {
            let g = state.graph.lock().unwrap();
            g.node_by_shape_id(shape_id)
                .map(|n| format!("{} (cópia)", n.label))
                .unwrap_or_else(|| "Clone".into())
        };
        state.graph.lock().unwrap().add_node(&label, CadOp::Clone {}, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

// ─── Operações Booleanas ──────────────────────────────────────────────────────

#[tauri::command]
fn boolean_union(state: tauri::State<AppState>, id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_union_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_union falhou (A={}, B={})", id_a, id_b)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        let node_id = g.add_node("Union", CadOp::Union {}, id);
        g.add_edge(id_a, id);
        g.add_edge(id_b, id);
        g.remove_by_shape_id(id_b); // B foi consumido pelo kernel
        let _ = node_id;
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn boolean_cut(state: tauri::State<AppState>, id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_cut_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_cut falhou (A={}, B={})", id_a, id_b)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node("Cut", CadOp::Cut {}, id);
        g.add_edge(id_a, id);
        g.add_edge(id_b, id);
        g.remove_by_shape_id(id_b);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn boolean_intersect(state: tauri::State<AppState>, id_a: i32, id_b: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = boolean_intersect_c(id_a, id_b, &mut raw);
        if id < 0 { return Err(format!("boolean_intersect falhou (A={}, B={})", id_a, id_b)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node("Intersect", CadOp::Intersect {}, id);
        g.add_edge(id_a, id);
        g.add_edge(id_b, id);
        g.remove_by_shape_id(id_b);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

// ─── Fillet / Chamfer / Shell ─────────────────────────────────────────────────

#[tauri::command]
fn fillet_shape(state: tauri::State<AppState>, shape_id: i32, radius: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = fillet_all_c(shape_id, radius, &mut raw);
        if id < 0 { return Err(format!("fillet_shape falhou (id={}, r={})", shape_id, radius)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node(&format!("Fillet r={}", radius), CadOp::Fillet { radius }, id);
        g.add_edge(shape_id, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn chamfer_shape(state: tauri::State<AppState>, shape_id: i32, dist: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = chamfer_all_c(shape_id, dist, &mut raw);
        if id < 0 { return Err(format!("chamfer_shape falhou (id={}, d={})", shape_id, dist)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node(&format!("Chamfer d={}", dist), CadOp::Chamfer { dist }, id);
        g.add_edge(shape_id, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn shell_shape(state: tauri::State<AppState>, shape_id: i32, thickness: f32) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = shell_c(shape_id, thickness, &mut raw);
        if id < 0 { return Err(format!("shell_shape falhou (id={}, t={})", shape_id, thickness)); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node(&format!("Shell t={}", thickness), CadOp::Shell { thickness }, id);
        g.add_edge(shape_id, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

// ─── Export ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn export_stl(shape_id: i32, path: String) -> Result<(), String> {
    use std::ffi::CString;
    let c_path = CString::new(path.as_str()).map_err(|e| e.to_string())?;
    let ok = unsafe { export_stl_c(shape_id, c_path.as_ptr()) };
    if ok < 0 { Err(format!("export_stl falhou para shape {}", shape_id)) } else { Ok(()) }
}

#[tauri::command]
fn export_step(shape_id: i32, path: String) -> Result<(), String> {
    use std::ffi::CString;
    let c_path = CString::new(path.as_str()).map_err(|e| e.to_string())?;
    let ok = unsafe { export_step_c(shape_id, c_path.as_ptr()) };
    if ok < 0 { Err(format!("export_step falhou para shape {}", shape_id)) } else { Ok(()) }
}

/// Retorna os pontos médios das arestas do shape para raycasting no frontend.
/// Cada aresta → [x, y, z] em espaço local do shape.
#[tauri::command]
fn get_edge_midpoints(shape_id: i32) -> Result<Vec<[f32; 3]>, String> {
    unsafe {
        let n = get_edge_count_c(shape_id);
        if n < 0 { return Err(format!("Shape {} não encontrado", shape_id)); }
        let mut buf = vec![0f32; (n as usize) * 3];
        let got = get_edge_midpoints_c(shape_id, buf.as_mut_ptr(), n);
        if got < 0 { return Err("get_edge_midpoints falhou".into()); }
        Ok((0..got as usize).map(|i| [buf[i*3], buf[i*3+1], buf[i*3+2]]).collect())
    }
}

/// Aplica fillet a arestas específicas por índice (edge_indices: Vec<i32> 0-based).
#[tauri::command]
fn fillet_edges(
    state: tauri::State<AppState>,
    shape_id: i32, edge_indices: Vec<i32>, radius: f32,
) -> Result<ShapeMesh, String> {
    if edge_indices.is_empty() { return Err("Nenhuma aresta selecionada".into()); }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = fillet_edges_c(shape_id, edge_indices.as_ptr(), edge_indices.len() as i32, radius, &mut raw);
        if id < 0 { return Err(format!("fillet_edges falhou (shape={}, n={})", shape_id, edge_indices.len())); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node(&format!("Fillet r={} ({} arestas)", radius, edge_indices.len()), CadOp::Fillet { radius }, id);
        g.add_edge(shape_id, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

/// Aplica chamfer a arestas específicas por índice (edge_indices: Vec<i32> 0-based).
#[tauri::command]
fn chamfer_edges(
    state: tauri::State<AppState>,
    shape_id: i32, edge_indices: Vec<i32>, dist: f32,
) -> Result<ShapeMesh, String> {
    if edge_indices.is_empty() { return Err("Nenhuma aresta selecionada".into()); }
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = chamfer_edges_c(shape_id, edge_indices.as_ptr(), edge_indices.len() as i32, dist, &mut raw);
        if id < 0 { return Err(format!("chamfer_edges falhou (shape={}, n={})", shape_id, edge_indices.len())); }
        let mesh = collect_mesh(&mut raw)?;
        let mut g = state.graph.lock().unwrap();
        g.add_node(&format!("Chamfer d={} ({} arestas)", dist, edge_indices.len()), CadOp::Chamfer { dist }, id);
        g.add_edge(shape_id, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

/// Desfaz a última operação sobre o shape e retorna a nova malha.
#[tauri::command]
fn undo_shape(shape_id: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let depth = undo_depth_c(shape_id);
        if depth <= 0 { return Err(format!("Nada a desfazer para shape {}", shape_id)); }
        let mut raw = OcctMesh::empty();
        let id = undo_shape_c(shape_id, &mut raw);
        if id < 0 { return Err(format!("undo_shape falhou para shape {}", shape_id)); }
        let mesh = collect_mesh(&mut raw)?;
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

/// Refaz a operação desfeita (Ctrl+Y).
#[tauri::command]
fn redo_shape(shape_id: i32) -> Result<ShapeMesh, String> {
    unsafe {
        let depth = redo_depth_c(shape_id);
        if depth <= 0 { return Err(format!("Nada a refazer para shape {}", shape_id)); }
        let mut raw = OcctMesh::empty();
        let id = redo_shape_c(shape_id, &mut raw);
        if id < 0 { return Err(format!("redo_shape falhou para shape {}", shape_id)); }
        let mesh = collect_mesh(&mut raw)?;
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

// ─── DAG Paramétrico — Comandos Novos ────────────────────────────────────────

/// Retorna o grafo completo (nós + arestas) como JSON para visualização no frontend.
#[tauri::command]
fn get_graph(state: tauri::State<AppState>) -> serde_json::Value {
    state.graph.lock().unwrap().to_json()
}

/// Dados retornados pelo update_param: todos os shapes re-avaliados.
#[derive(Serialize)]
struct UpdateResult {
    updated: Vec<ShapeMesh>,
}

/// Edita os parâmetros de um nó e re-avalia todos os dependentes.
///
/// `node_id`: ID estável do nó (u32, retornado pelo grafo)
/// `params`:  JSON com os novos parâmetros (ex: `{"radius": 15.0}`)
#[tauri::command]
fn update_param(
    state: tauri::State<AppState>,
    node_id: u32,
    params: serde_json::Value,
) -> Result<UpdateResult, String> {
    let mut updated = vec![];

    // 1. Aplicar novos parâmetros ao nó e re-criar o shape primitivo
    let (old_shape_id, new_op) = {
        let g = state.graph.lock().unwrap();
        let node = g.node_by_id(node_id).ok_or("Nó não encontrado")?;
        let old_sid = node.shape_id.ok_or("Nó sem shape_id")?;
        let new_op = apply_params(node.op.clone(), &params)?;
        (old_sid, new_op)
    };

    // 2. Executar a operação OCCT com os novos parâmetros
    let new_shape_mesh = execute_op(&new_op, &[])?;
    let new_sid = new_shape_mesh.shape_id;

    // 3. Remover shape antigo e atualizar o grafo
    unsafe { remove_shape_c(old_shape_id); }
    {
        let mut g = state.graph.lock().unwrap();
        // Atualiza op e shape_id no nó
        if let Some(node) = g.node_by_id_mut(node_id) {
            node.op = new_op.clone();
            let label = op_label(&new_op);
            node.label = label;
        }
        g.update_shape_id(node_id, new_sid);
    }
    updated.push(new_shape_mesh);

    // 4. Re-avaliar todos os dependentes em ordem topológica
    let dependents = state.graph.lock().unwrap().dependents_sorted(node_id);
    for dep_id in dependents {
        let mesh = reevaluate_node(dep_id, &state)?;
        updated.push(mesh);
    }

    Ok(UpdateResult { updated })
}

/// Aplica um JSON de parâmetros a uma CadOp existente, retornando a op modificada.
fn apply_params(op: CadOp, params: &serde_json::Value) -> Result<CadOp, String> {
    let get_f32 = |key: &str, default: f32| -> f32 {
        params.get(key)
            .and_then(|v| v.as_f64())
            .map(|v| v as f32)
            .unwrap_or(default)
    };
    Ok(match op {
        CadOp::Box { width, height, depth } => CadOp::Box {
            width:  get_f32("width",  width),
            height: get_f32("height", height),
            depth:  get_f32("depth",  depth),
        },
        CadOp::Cylinder { radius, height } => CadOp::Cylinder {
            radius: get_f32("radius", radius),
            height: get_f32("height", height),
        },
        CadOp::Sphere { radius } => CadOp::Sphere {
            radius: get_f32("radius", radius),
        },
        CadOp::Cone { radius_bottom, radius_top, height } => CadOp::Cone {
            radius_bottom: get_f32("radius_bottom", radius_bottom),
            radius_top:    get_f32("radius_top",    radius_top),
            height:        get_f32("height",        height),
        },
        CadOp::Fillet { radius } => CadOp::Fillet { radius: get_f32("radius", radius) },
        CadOp::Chamfer { dist }  => CadOp::Chamfer { dist: get_f32("dist", dist) },
        CadOp::Shell { thickness } => CadOp::Shell { thickness: get_f32("thickness", thickness) },
        other => other,
    })
}

/// Executa uma CadOp com os shape_ids dos inputs já resolvidos.
fn execute_op(op: &CadOp, input_ids: &[i32]) -> Result<ShapeMesh, String> {
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = match op {
            CadOp::Box { width, height, depth } =>
                create_box_c(*width as f64, *height as f64, *depth as f64, &mut raw),
            CadOp::Cylinder { radius, height } =>
                create_cylinder_c(*radius as f64, *height as f64, &mut raw),
            CadOp::Sphere { radius } =>
                create_sphere_c(*radius as f64, &mut raw),
            CadOp::Cone { radius_bottom, radius_top, height } =>
                create_cone_c(*radius_bottom as f64, *radius_top as f64, *height as f64, &mut raw),
            CadOp::Union { .. } if input_ids.len() >= 2 =>
                boolean_union_c(input_ids[0], input_ids[1], &mut raw),
            CadOp::Cut { .. }   if input_ids.len() >= 2 =>
                boolean_cut_c(input_ids[0], input_ids[1], &mut raw),
            CadOp::Intersect { .. } if input_ids.len() >= 2 =>
                boolean_intersect_c(input_ids[0], input_ids[1], &mut raw),
            CadOp::Fillet { radius } if !input_ids.is_empty() =>
                fillet_all_c(input_ids[0], *radius, &mut raw),
            CadOp::Chamfer { dist } if !input_ids.is_empty() =>
                chamfer_all_c(input_ids[0], *dist, &mut raw),
            CadOp::Shell { thickness } if !input_ids.is_empty() =>
                shell_c(input_ids[0], *thickness, &mut raw),
            _ => return Err(format!("execute_op: inputs insuficientes para {:?}", op)),
        };
        if id < 0 { return Err(format!("execute_op falhou para {:?}", op)); }
        Ok(ShapeMesh { shape_id: id, mesh: collect_mesh(&mut raw)? })
    }
}

/// Re-avalia um nó dependente buscando os inputs actuais no grafo.
fn reevaluate_node(dep_stable_id: u32, state: &tauri::State<AppState>) -> Result<ShapeMesh, String> {
    let (op, input_ids, old_shape_id) = {
        let g = state.graph.lock().unwrap();
        let node = g.node_by_id(dep_stable_id).ok_or("Dependente não encontrado")?;
        let op   = node.op.clone();
        let inputs = g.inputs_of(dep_stable_id);
        let old_sid = node.shape_id;
        (op, inputs, old_sid)
    };

    let mesh = execute_op(&op, &input_ids)?;
    let new_sid = mesh.shape_id;

    // Remover shape antigo
    if let Some(old) = old_shape_id {
        unsafe { remove_shape_c(old); }
    }

    // Atualizar grafo
    state.graph.lock().unwrap().update_shape_id(dep_stable_id, new_sid);
    Ok(mesh)
}

fn op_label(op: &CadOp) -> String {
    match op {
        CadOp::Box { width, height, depth } => format!("Caixa {:.0}×{:.0}×{:.0}", width, height, depth),
        CadOp::Cylinder { radius, height }  => format!("Cilindro R{:.0} H{:.0}", radius, height),
        CadOp::Sphere { radius }            => format!("Esfera R{:.0}", radius),
        CadOp::Cone { radius_bottom, radius_top, height } =>
            format!("Cone Rb{:.0} Rt{:.0} H{:.0}", radius_bottom, radius_top, height),
        CadOp::Fillet { radius }    => format!("Fillet r={}", radius),
        CadOp::Chamfer { dist }     => format!("Chamfer d={}", dist),
        CadOp::Shell { thickness }  => format!("Shell t={}", thickness),
        CadOp::Union { .. }         => "Union".into(),
        CadOp::Cut { .. }           => "Cut".into(),
        CadOp::Intersect { .. }     => "Intersect".into(),
        CadOp::Transform { .. }     => "Transform".into(),
        CadOp::Clone { .. }         => "Clone".into(),
    }
}

// ─── Fase 4: Comandos ─────────────────────────────────────────────────────────

/// Plano de trabalho: informações de uma face (origin, normal, u_axis, v_axis).
#[derive(Serialize)]
pub struct PlaneInfo {
    pub origin: [f32; 3],
    pub normal: [f32; 3],
    pub u_axis: [f32; 3],
    pub v_axis: [f32; 3],
}

#[tauri::command]
fn get_face_plane(shape_id: i32, face_index: i32) -> Result<PlaneInfo, String> {
    unsafe {
        let mut buf = [0f32; 12]; // origin[3] + normal[3] + u[3] + v[3]
        let ok = get_face_plane_c(shape_id, face_index, buf.as_mut_ptr());
        if ok < 0 { return Err(format!("get_face_plane falhou (shape={}, face={})", shape_id, face_index)); }
        Ok(PlaneInfo {
            origin: [buf[0], buf[1], buf[2]],
            normal: [buf[3], buf[4], buf[5]],
            u_axis: [buf[6], buf[7], buf[8]],
            v_axis: [buf[9], buf[10], buf[11]],
        })
    }
}

#[tauri::command]
fn extrude_profile(
    state: tauri::State<AppState>,
    xy_points: Vec<f32>,
    plane_matrix: Vec<f32>,
    depth: f32,
    fuse_with: Option<i32>,
) -> Result<ShapeMesh, String> {
    if xy_points.len() < 4 || xy_points.len() % 2 != 0 { return Err("xy_points inválido".into()); }
    if plane_matrix.len() != 16 { return Err("plane_matrix deve ter 16 elementos".into()); }
    let n_pts = (xy_points.len() / 2) as i32;
    let fuse_id = fuse_with.unwrap_or(-1);
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = extrude_profile_c(
            xy_points.as_ptr(), n_pts,
            plane_matrix.as_ptr(),
            depth, fuse_id,
            &mut raw,
        );
        if id < 0 { return Err(format!("extrude_profile falhou (depth={})", depth)); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Extrude d={:.1}", depth);
        state.graph.lock().unwrap().add_node(&label, CadOp::Clone {}, id); // CadOp::Extrude futuro
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

#[tauri::command]
fn revolve_profile(
    state: tauri::State<AppState>,
    xy_points: Vec<f32>,
    plane_matrix: Vec<f32>,
    axis: [f32; 3],
    angle_deg: f32,
    fuse_with: Option<i32>,
) -> Result<ShapeMesh, String> {
    if xy_points.len() < 4 || xy_points.len() % 2 != 0 { return Err("xy_points inválido".into()); }
    if plane_matrix.len() != 16 { return Err("plane_matrix deve ter 16 elementos".into()); }
    let n_pts = (xy_points.len() / 2) as i32;
    let fuse_id = fuse_with.unwrap_or(-1);
    unsafe {
        let mut raw = OcctMesh::empty();
        let id = revolve_profile_c(
            xy_points.as_ptr(), n_pts,
            plane_matrix.as_ptr(),
            axis.as_ptr(),
            angle_deg, fuse_id,
            &mut raw,
        );
        if id < 0 { return Err(format!("revolve_profile falhou (angle={})", angle_deg)); }
        let mesh = collect_mesh(&mut raw)?;
        let label = format!("Revolve {:.0}°", angle_deg);
        state.graph.lock().unwrap().add_node(&label, CadOp::Clone {}, id);
        Ok(ShapeMesh { shape_id: id, mesh })
    }
}

/// Helper: converte SketchResult C → Vec de contornos Vec<[f32;2]>
unsafe fn collect_sketch(raw: &mut SketchResult) -> Result<Vec<Vec<[f32; 2]>>, String> {
    if raw.contour_count <= 0 {
        free_sketch_result(raw);
        return Ok(vec![]);
    }
    let counts = std::slice::from_raw_parts(raw.point_counts, raw.contour_count as usize);
    let points = std::slice::from_raw_parts(raw.points, raw.total_points as usize * 2);
    let mut result = Vec::with_capacity(raw.contour_count as usize);
    let mut offset = 0usize;
    for &cnt in counts {
        let mut contour = Vec::with_capacity(cnt as usize);
        for _ in 0..cnt {
            contour.push([points[offset], points[offset + 1]]);
            offset += 2;
        }
        result.push(contour);
    }
    free_sketch_result(raw);
    Ok(result)
}

#[tauri::command]
fn sketch_boolean(
    a_points: Vec<f32>, b_points: Vec<f32>, op: i32,
) -> Result<Vec<Vec<[f32; 2]>>, String> {
    if a_points.len() < 4 || b_points.len() < 4 { return Err("Contornos precisam de ≥2 pontos".into()); }
    let a_n = (a_points.len() / 2) as i32;
    let b_n = (b_points.len() / 2) as i32;
    unsafe {
        let mut raw = SketchResult::empty();
        let ok = sketch_boolean_c(a_points.as_ptr(), a_n, b_points.as_ptr(), b_n, op, &mut raw);
        if ok < 0 { return Err("sketch_boolean falhou".into()); }
        collect_sketch(&mut raw)
    }
}

#[tauri::command]
fn sketch_offset(
    points: Vec<f32>, offset: f32, use_arcs: bool, closed: bool,
    bulges: Option<Vec<f32>>,
) -> Result<Vec<Vec<[f32; 2]>>, String> {
    if points.len() < 4 { return Err("Contorno precisa de ≥2 pontos".into()); }
    let n = (points.len() / 2) as i32;
    unsafe {
        let mut raw = SketchResult::empty();
        let ok = if use_arcs {
            let b_ptr = bulges.as_ref().map(|v| v.as_ptr()).unwrap_or(std::ptr::null());
            sketch_offset_arcs_c(points.as_ptr(), n, b_ptr, offset, &mut raw)
        } else {
            sketch_offset_segments_c(points.as_ptr(), n, offset, closed as i32, &mut raw)
        };
        if ok < 0 { return Err("sketch_offset falhou".into()); }
        collect_sketch(&mut raw)
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState { graph: Mutex::new(CadGraph::new()) })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            create_box, create_cylinder, create_sphere, create_cone,
            transform_shape, delete_shape, clone_shape,
            boolean_union, boolean_cut, boolean_intersect,
            fillet_shape, chamfer_shape, shell_shape,
            fillet_edges, chamfer_edges, get_edge_midpoints,
            undo_shape, redo_shape,
            export_stl, export_step,
            get_graph, update_param,
            // Fase 4
            get_face_plane, extrude_profile, revolve_profile,
            sketch_boolean, sketch_offset,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar a aplicação Tauri");
}
