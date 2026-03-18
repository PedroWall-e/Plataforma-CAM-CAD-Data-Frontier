/*
 * occt_bridge_c.h — FFI bridge C-compatible (Fase 2: shape store + transform)
 */
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OcctMesh {
    float*    vertices;
    int       vertex_count;
    unsigned* indices;
    int       index_count;
} OcctMesh;

/* ── Primitivas (devolve shape_id ≥ 1; -1 em caso de erro) ─────────────────── */
int  create_box_c     (double w, double h, double d, OcctMesh* out);
int  create_cylinder_c(double radius, double height, OcctMesh* out);
int  create_sphere_c  (double radius, OcctMesh* out);
int  create_cone_c    (double rb, double rt, double height, OcctMesh* out);

/* Mantém backwards-compat: não armazena, não retorna ID */
void generate_box_mesh_c     (double w, double h, double d, OcctMesh* out);
void generate_cylinder_mesh_c(double radius, double height, OcctMesh* out);
void generate_sphere_mesh_c  (double radius, OcctMesh* out);
void generate_cone_mesh_c    (double rb, double rt, double height, OcctMesh* out);

/* ── Transformações ─────────────────────────────────────────────────────────── */
/* matrix16: array de 16 floats, coluna-major (formato Three.js Matrix4.elements)
 * Suporta translate + rotate + scale não-uniforme (usa gp_GTrsf).
 * Retorna shape_id actualizado, ou -1 se shape_id não existir.              */
int  transform_shape_c(int shape_id, const float* matrix16, OcctMesh* out);

/* Remove o shape da store (liberta memória OCCT). */
void remove_shape_c(int shape_id);

/* Duplica o shape na store e devolve o novo shape_id (≥1) ou -1 em erro. */
int  clone_shape_c(int shape_id, OcctMesh* out);

/* ── Operações Booleanas ─────────────────────────────────────────────────────── */
/* Resultado substitui shape idA; shape idB é removido do store.
 * Retorna idA em sucesso, -1 em erro.                                           */
int boolean_union_c    (int id_a, int id_b, OcctMesh* out);
int boolean_cut_c      (int id_a, int id_b, OcctMesh* out);
int boolean_intersect_c(int id_a, int id_b, OcctMesh* out);

/* ── Fillet & Chamfer ────────────────────────────────────────────────────────── */
/* Aplica a TODAS as arestas do shape. Retorna shape_id ou -1.                   */
int fillet_all_c (int shape_id, float radius, OcctMesh* out);
int chamfer_all_c(int shape_id, float dist,   OcctMesh* out);

/* Retorna o número de arestas indexadas do shape (para listagem no frontend). */
int get_edge_count_c(int shape_id);

/* Retorna os pontos médios das arestas do shape como array float[3*n].
 * out_xyz deve ter espaço para get_edge_count_c(shape_id)*3 floats.
 * Retorna n de arestas ou -1 em erro.                                           */
int get_edge_midpoints_c(int shape_id, float* out_xyz, int max_edges);

/* Aplica fillet/chamfer a arestas específicas (edge_ids[] com n ids).
 * Retorna shape_id resultante ou -1 em erro.                                    */
int fillet_edges_c (int shape_id, const int* edge_ids, int n, float radius, OcctMesh* out);
int chamfer_edges_c(int shape_id, const int* edge_ids, int n, float dist,   OcctMesh* out);

/* ── Undo / Redo ──────────────────────────────────────────────────────────────────────── */
/* Profundidade da pilha de undo/redo para o shape (0 = vazia).                  */
int undo_depth_c(int shape_id);
int redo_depth_c(int shape_id);
/* Desfaz/refaz a última operação sobre shape_id.
 * out pode ser NULL se não quiser tesselação. Retorna shape_id ou -1.           */
int undo_shape_c(int shape_id, OcctMesh* out);
int redo_shape_c(int shape_id, OcctMesh* out);

/* ── Shell (Casca oca) ───────────────────────────────────────────────────────── */
/* Remove a face superior (max Y) e aplica espessura inward. Retorna shape_id.  */
int shell_c(int shape_id, float thickness, OcctMesh* out);

/* ── Export ────────────────────────────────────────────────── */
int export_stl_c (int shape_id, const char* path); /* 0=ok, -1=erro */
int export_step_c(int shape_id, const char* path); /* 0=ok, -1=erro */

/* ── Memoria ─────────────────────────────────────────────────────────────────── */
void free_occt_mesh(OcctMesh* mesh);

/* ── Fase 4: Sketching 2D ────────────────────────────────────────────────────── */
int get_face_plane_c(int shape_id, int face_index, float* out_f32);
int extrude_profile_c(
    const float* xy, int n_pts,
    const float* plane_mat16,
    float depth,
    int fuse_with,
    OcctMesh* out
);
int revolve_profile_c(
    const float* xy, int n_pts,
    const float* plane_mat16,
    const float* axis_xyz,
    float angle_deg,
    int fuse_with,
    OcctMesh* out
);

#ifdef __cplusplus
}
#endif
