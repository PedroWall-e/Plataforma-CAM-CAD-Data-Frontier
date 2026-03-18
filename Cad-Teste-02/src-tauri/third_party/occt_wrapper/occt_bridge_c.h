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

/* ── Shell (Casca oca) ───────────────────────────────────────────────────────── */
/* Remove a face superior (max Y) e aplica espessura inward. Retorna shape_id.  */
int shell_c(int shape_id, float thickness, OcctMesh* out);

/* ── Export ────────────────────────────────────────────────── */
int export_stl_c (int shape_id, const char* path); /* 0=ok, -1=erro */
int export_step_c(int shape_id, const char* path); /* 0=ok, -1=erro */

/* ── Memoria ─────────────────────────────────────────────────────────────────── */
void free_occt_mesh(OcctMesh* mesh);

#ifdef __cplusplus
}
#endif
