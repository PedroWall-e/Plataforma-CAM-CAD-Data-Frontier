/*
 * sketch_bridge_stub.cpp — Implementações stub (sem Clipper2).
 *
 * Usadas quando Clipper2 não está disponível na build.
 * Todas as funções retornam -1 (erro), sinalizando ao frontend
 * que a operação não está disponível.
 *
 * Para ativar a implementação real, consulte sketch_bridge_c.cpp
 * e instale o Clipper2 conforme third_party/clipper2/README.md.
 */

#include "sketch_bridge_c.h"
#include <cstdlib>
#include <cstring>

extern "C" {

int sketch_boolean_c(
    const float* /*a_xy*/, int /*a_n*/,
    const float* /*b_xy*/, int /*b_n*/,
    int /*op*/,
    SketchResult* out
) {
    if (out) { memset(out, 0, sizeof(SketchResult)); }
    return -1; // Clipper2 não disponível
}

int sketch_offset_segments_c(
    const float* /*xy*/, int /*n*/,
    float /*offset*/,
    int  /*closed*/,
    SketchResult* out
) {
    if (out) { memset(out, 0, sizeof(SketchResult)); }
    return -1;
}

int sketch_offset_arcs_c(
    const float* /*xy*/,     int   /*n*/,
    const float* /*bulges*/,
    float        /*offset*/,
    SketchResult* out
) {
    if (out) { memset(out, 0, sizeof(SketchResult)); }
    return -1;
}

void free_sketch_result(SketchResult* r) {
    if (!r) return;
    // Stub: nada a liberar (never allocated)
    r->points       = nullptr;
    r->point_counts = nullptr;
    r->contour_count = 0;
    r->total_points  = 0;
}

} // extern "C"
