/*
 * sketch_bridge_c.cpp — Implementação do FFI para operações 2D
 *
 * Usa:
 *   Clipper2  → booleanas 2D (union, cut, intersect, offset por segmentos)
 *   CavalierContours → offset com arcos exatos (bulge-aware polylines)
 *
 * Padrão idêntico ao occt_bridge_c.cpp:
 *   - Dados recebidos como arrays float simples
 *   - Resultados alocados com malloc / retornados via ponteiro de saída
 *   - Chamador deve chamar free_sketch_result() após usar
 *
 * ATENÇÃO: Este arquivo assume que as seguintes libs
 *   estão disponíveis via include path (build.rs):
 *   - third_party/clipper2/clipper.h
 *   - third_party/cavalier_contours/cavc/polyline.hpp
 *   - third_party/cavalier_contours/cavc/polylineoffset.hpp
 */

#include "sketch_bridge_c.h"

// ── Clipper2 ─────────────────────────────────────────────────────────────────
// Nota: o build.rs adiciona third_party/ ao include path, então
// "clipper2/clipper.h" resolve para third_party/clipper2/clipper.h
#include "clipper2/clipper.h"
using namespace Clipper2Lib;

// ── CavalierContours ─────────────────────────────────────────────────────────
#include "../cavalier_contours/cavc/polyline.hpp"
#include "../cavalier_contours/cavc/polylineoffset.hpp"

#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>

/* Fator de escala: Clipper2 trabalha em inteiros (int64).
 * Multiplicamos por este fator para preservar precisão decimal (2 casas = 100). */
static constexpr double CLIPPER_SCALE = 100.0;

// ─── Helpers Clipper2 ────────────────────────────────────────────────────────

static Path64 floats_to_path(const float* xy, int n) {
    Path64 path;
    path.reserve(n);
    for (int i = 0; i < n; ++i)
        path.push_back(Point64(
            static_cast<int64_t>(xy[i*2  ] * CLIPPER_SCALE),
            static_cast<int64_t>(xy[i*2+1] * CLIPPER_SCALE)
        ));
    return path;
}

static void paths_to_sketch_result(const Paths64& paths, SketchResult* out) {
    out->contour_count = static_cast<int>(paths.size());
    out->point_counts  = static_cast<int*>(malloc(out->contour_count * sizeof(int)));

    int total = 0;
    for (int c = 0; c < out->contour_count; ++c) {
        out->point_counts[c] = static_cast<int>(paths[c].size());
        total += out->point_counts[c];
    }
    out->total_points = total;
    out->points = static_cast<float*>(malloc(total * 2 * sizeof(float)));

    int idx = 0;
    for (int c = 0; c < out->contour_count; ++c) {
        for (const auto& pt : paths[c]) {
            out->points[idx++] = static_cast<float>(pt.x / CLIPPER_SCALE);
            out->points[idx++] = static_cast<float>(pt.y / CLIPPER_SCALE);
        }
    }
}

// ─── Booleanas 2D ────────────────────────────────────────────────────────────

extern "C" int sketch_boolean_c(
    const float* a_xy, int a_n,
    const float* b_xy, int b_n,
    int op,
    SketchResult* out
) {
    if (!a_xy || a_n < 3 || !b_xy || b_n < 3 || !out) return -1;

    // Inicializa out com zeros para segurança
    out->points = nullptr; out->point_counts = nullptr;
    out->contour_count = 0; out->total_points = 0;

    try {
        Paths64 subject = { floats_to_path(a_xy, a_n) };
        Paths64 clip    = { floats_to_path(b_xy, b_n) };
        Paths64 result;

        switch (op) {
            case 0: result = Union(subject, clip, FillRule::NonZero); break;
            case 1: result = Difference(subject, clip, FillRule::NonZero); break;
            case 2: result = Intersect(subject, clip, FillRule::NonZero); break;
            default: return -1;
        }

        if (result.empty()) {
            // Resultado vazio é válido (ex: sem intersecção)
            out->contour_count = 0;
            out->total_points  = 0;
            return 0;
        }

        paths_to_sketch_result(result, out);
        return 0;
    } catch (...) {
        return -1;
    }
}

// ─── Offset por segmentos (Clipper2) ─────────────────────────────────────────

extern "C" int sketch_offset_segments_c(
    const float* xy, int n,
    float offset,
    int closed,
    SketchResult* out
) {
    if (!xy || n < 2 || !out) return -1;

    out->points = nullptr; out->point_counts = nullptr;
    out->contour_count = 0; out->total_points = 0;

    try {
        Path64 path = floats_to_path(xy, n);
        Paths64 subject = { path };
        Paths64 result;

        ClipperOffset co;
        JoinType jt = JoinType::Round;
        EndType  et = closed ? EndType::Polygon : EndType::Square;

        co.AddPaths(subject, jt, et);
        co.Execute(static_cast<double>(offset) * CLIPPER_SCALE, result);

        if (result.empty()) { out->contour_count = 0; out->total_points = 0; return 0; }
        paths_to_sketch_result(result, out);
        return 0;
    } catch (...) {
        return -1;
    }
}

// ─── Offset com arcos (CavalierContours) ─────────────────────────────────────

extern "C" int sketch_offset_arcs_c(
    const float* xy, int n,
    const float* bulges,   /* NULL = todos retos (bulge=0) */
    float offset,
    SketchResult* out
) {
    if (!xy || n < 2 || !out) return -1;

    out->points = nullptr; out->point_counts = nullptr;
    out->contour_count = 0; out->total_points = 0;

    try {
        // Constrói polyline CavalierContours
        cavc::Polyline<double> pl;
        pl.isClosed() = (n > 2); // fechado se mais de 2 pontos

        for (int i = 0; i < n; ++i) {
            double b = (bulges && i < n) ? static_cast<double>(bulges[i]) : 0.0;
            pl.addVertex(
                static_cast<double>(xy[i*2  ]),
                static_cast<double>(xy[i*2+1]),
                b
            );
        }

        // Executa offset
        std::vector<cavc::Polyline<double>> results =
            cavc::parallelOffset(pl, static_cast<double>(offset));

        if (results.empty()) { out->contour_count = 0; out->total_points = 0; return 0; }

        // Converte resultado para SketchResult
        out->contour_count = static_cast<int>(results.size());
        out->point_counts  = static_cast<int*>(malloc(out->contour_count * sizeof(int)));
        int total = 0;
        for (int c = 0; c < out->contour_count; ++c) {
            out->point_counts[c] = static_cast<int>(results[c].size());
            total += out->point_counts[c];
        }
        out->total_points = total;
        out->points = static_cast<float*>(malloc(total * 2 * sizeof(float)));

        int idx = 0;
        for (int c = 0; c < out->contour_count; ++c) {
            for (std::size_t v = 0; v < results[c].size(); ++v) {
                const auto& vtx = results[c].vertexes()[v];
                out->points[idx++] = static_cast<float>(vtx.x());
                out->points[idx++] = static_cast<float>(vtx.y());
            }
        }
        return 0;
    } catch (...) {
        return -1;
    }
}

// ─── Limpeza ─────────────────────────────────────────────────────────────────

extern "C" void free_sketch_result(SketchResult* r) {
    if (!r) return;
    free(r->points);      r->points       = nullptr;
    free(r->point_counts); r->point_counts = nullptr;
    r->contour_count = 0;
    r->total_points  = 0;
}
