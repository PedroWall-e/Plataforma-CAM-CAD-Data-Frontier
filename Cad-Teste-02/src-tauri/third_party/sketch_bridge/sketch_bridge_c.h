/*
 * sketch_bridge_c.h — FFI C puro para Clipper2 + CavalierContours
 *
 * Padrão idêntico ao occt_bridge_c.h:
 *  - Funções com sufixo _c
 *  - Inputs/outputs em arrays de float (x,y pairs)
 *  - SketchResult alocado via malloc, liberado via free_sketch_result()
 */

#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ─── Tipos de saída ──────────────────────────────────────────────────────── */

/**
 * Resultado de uma operação 2D.
 * Podem ser N contornos distintos (ex: after a Cut que gera múltiplos polígonos).
 *
 * Layout:
 *   points[0..point_counts[0]*2-1]            → contour 0 (x,y pairs)
 *   points[point_counts[0]*2 .. ...]           → contour 1
 *   ...
 */
typedef struct {
    float*   points;         /* x0,y0, x1,y1, ... (flat array para todos os contornos) */
    int*     point_counts;   /* nº de pontos por contorno */
    int      contour_count;  /* nº de contornos no resultado */
    int      total_points;   /* soma de point_counts[] */
} SketchResult;

/* ─── Operações booleanas 2D (Clipper2) ──────────────────────────────────── */

/**
 * sketch_boolean_c — Une, subtrai ou intersecta dois polígonos 2D.
 *
 * @param a_xy      Contorno A: array de x,y pairs, tamanho 2*a_n
 * @param a_n       Nº de pontos do contorno A
 * @param b_xy      Contorno B: array de x,y pairs, tamanho 2*b_n
 * @param b_n       Nº de pontos do contorno B
 * @param op        0 = Union, 1 = Difference (A-B), 2 = Intersection
 * @param out       Resultado alocado internamente (liberar com free_sketch_result)
 * @return 0 em sucesso, -1 em erro
 */
int sketch_boolean_c(
    const float* a_xy, int a_n,
    const float* b_xy, int b_n,
    int op,
    SketchResult* out
);

/* ─── Offset de contorno ─────────────────────────────────────────────────── */

/**
 * sketch_offset_segments_c — Offset usando Clipper2 (apenas segmentos, sem arcos).
 * Use para offsets rápidos quando arcos não são necessários.
 *
 * @param xy        Contorno original: x,y pairs
 * @param n         Nº de pontos
 * @param offset    Distância do offset (positivo = expandir, negativo = contrair)
 * @param closed    1 se o contorno é fechado, 0 se aberto
 * @param out       Resultado (liberar com free_sketch_result)
 * @return 0 em sucesso, -1 em erro
 */
int sketch_offset_segments_c(
    const float* xy, int n,
    float offset,
    int closed,
    SketchResult* out
);

/**
 * sketch_offset_arcs_c — Offset usando CavalierContours (arcos exatos).
 * Ideal para perfis mecânicos onde a tangência dos cantos é importante.
 *
 * @param xy        Contorno original: x,y pairs
 * @param n         Nº de pontos
 * @param bulges    Curvatura de cada segmento (tan(ang/4)); NULL = todos 0 (linhas retas)
 * @param offset    Distância do offset
 * @param out       Resultado (liberar com free_sketch_result)
 * @return 0 em sucesso, -1 em erro
 */
int sketch_offset_arcs_c(
    const float* xy, int n,
    const float* bulges,
    float offset,
    SketchResult* out
);

/* ─── Limpeza ─────────────────────────────────────────────────────────────── */

/**
 * Libera a memória alocada por qualquer função sketch_*_c.
 */
void free_sketch_result(SketchResult* r);

#ifdef __cplusplus
} /* extern "C" */
#endif
