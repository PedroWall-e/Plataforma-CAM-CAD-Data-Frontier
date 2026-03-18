// graph.rs — DAG Paramétrico (Fase 3.1)
//
// Estratégia conservadora: operações operam sobre shapes _inteiros_.
// Não há referência a sub-entidades (arestas/faces), logo sem risco de TNP.

use petgraph::stable_graph::{NodeIndex, StableDiGraph};
use petgraph::Direction;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Parâmetros de cada tipo de nó ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CadOp {
    // Primitivas
    Box       { width: f32, height: f32, depth: f32 },
    Cylinder  { radius: f32, height: f32 },
    Sphere    { radius: f32 },
    Cone      { radius_bottom: f32, radius_top: f32, height: f32 },
    // Booleanas — dois inputs (a, b)
    Union     {},
    Cut       {},
    Intersect {},
    // Detalhamento — um input
    Fillet    { radius: f32 },
    Chamfer   { dist: f32 },
    Shell     { thickness: f32 },
    // Transformação — um input
    Transform { matrix: Vec<f32> },
    // Clone — um input
    Clone     {},
}

impl CadOp {
    /// Retorna true se o nó é uma primitiva (sem inputs de shape)
    pub fn is_primitive(&self) -> bool {
        matches!(self, CadOp::Box { .. } | CadOp::Cylinder { .. }
                     | CadOp::Sphere { .. } | CadOp::Cone { .. })
    }

    /// Número de inputs de shape esperados
    pub fn input_count(&self) -> usize {
        match self {
            CadOp::Box { .. } | CadOp::Cylinder { .. }
            | CadOp::Sphere { .. } | CadOp::Cone { .. } => 0,
            CadOp::Union { .. } | CadOp::Cut { .. } | CadOp::Intersect { .. } => 2,
            _ => 1,
        }
    }
}

// ─── Nó do grafo ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CadNode {
    /// ID estável do nó no grafo (índice petgraph)
    pub id: u32,
    /// Label visual (ex: "Caixa 10×10×5")
    pub label: String,
    /// O shape_id gerado pelo kernel OCCT na última avaliação
    pub shape_id: Option<i32>,
    /// Operação paramétrica deste nó
    pub op: CadOp,
}

// ─── CadGraph ─────────────────────────────────────────────────────────────────

pub struct CadGraph {
    graph: StableDiGraph<CadNode, ()>,
    /// Mapa shape_id → NodeIndex para busca rápida
    shape_map: HashMap<i32, NodeIndex>,
    /// Mapa id estável → NodeIndex
    id_map: HashMap<u32, NodeIndex>,
    next_id: u32,
}

impl CadGraph {
    pub fn new() -> Self {
        Self {
            graph: StableDiGraph::new(),
            shape_map: HashMap::new(),
            id_map: HashMap::new(),
            next_id: 1,
        }
    }

    // ── Inserção ───────────────────────────────────────────────────────────────

    pub fn add_node(&mut self, label: &str, op: CadOp, shape_id: i32) -> u32 {
        let stable_id = self.next_id;
        self.next_id += 1;
        let node = CadNode { id: stable_id, label: label.to_string(), shape_id: Some(shape_id), op };
        let idx = self.graph.add_node(node);
        self.shape_map.insert(shape_id, idx);
        self.id_map.insert(stable_id, idx);
        stable_id
    }

    /// Adiciona aresta de dependência: `from_shape` é input de `to_shape`
    pub fn add_edge(&mut self, from_shape_id: i32, to_shape_id: i32) {
        if let (Some(&a), Some(&b)) = (
            self.shape_map.get(&from_shape_id),
            self.shape_map.get(&to_shape_id),
        ) {
            // Edges: do pai para o filho (dependente)
            self.graph.add_edge(a, b, ());
        }
    }

    // ── Consulta ──────────────────────────────────────────────────────────────

    pub fn node_by_shape_id(&self, shape_id: i32) -> Option<&CadNode> {
        let idx = self.shape_map.get(&shape_id)?;
        self.graph.node_weight(*idx)
    }

    pub fn node_by_id(&self, stable_id: u32) -> Option<&CadNode> {
        let idx = self.id_map.get(&stable_id)?;
        self.graph.node_weight(*idx)
    }

    pub fn node_by_id_mut(&mut self, stable_id: u32) -> Option<&mut CadNode> {
        let idx = *self.id_map.get(&stable_id)?;
        self.graph.node_weight_mut(idx)
    }

    /// Todos os nós que dependem de `stable_id` (dependentes diretos e transitivos)
    /// Retornados em ordem topológica de avaliação.
    pub fn dependents_sorted(&self, stable_id: u32) -> Vec<u32> {
        let start = match self.id_map.get(&stable_id) {
            Some(idx) => *idx,
            None => return vec![],
        };
        let mut result = vec![];
        let mut visited = std::collections::HashSet::new();
        self.dfs_dependents(start, &mut visited, &mut result);
        result
    }

    fn dfs_dependents(
        &self,
        idx: NodeIndex,
        visited: &mut std::collections::HashSet<NodeIndex>,
        out: &mut Vec<u32>,
    ) {
        for neighbour in self.graph.neighbors_directed(idx, Direction::Outgoing) {
            if visited.insert(neighbour) {
                self.dfs_dependents(neighbour, visited, out);
                if let Some(n) = self.graph.node_weight(neighbour) {
                    out.push(n.id);
                }
            }
        }
    }

    /// Retorna os inputs (pais) de um nó, na ordem de inserção das arestas.
    pub fn inputs_of(&self, stable_id: u32) -> Vec<i32> {
        let idx = match self.id_map.get(&stable_id) {
            Some(i) => *i,
            None => return vec![],
        };
        self.graph
            .neighbors_directed(idx, Direction::Incoming)
            .filter_map(|i| self.graph.node_weight(i).and_then(|n| n.shape_id))
            .collect()
    }

    /// Remove nó pelo shape_id (usado em delete_shape)
    pub fn remove_by_shape_id(&mut self, shape_id: i32) {
        if let Some(&idx) = self.shape_map.get(&shape_id) {
            let stable_id = self.graph.node_weight(idx).map(|n| n.id);
            self.graph.remove_node(idx);
            self.shape_map.remove(&shape_id);
            if let Some(sid) = stable_id {
                self.id_map.remove(&sid);
            }
        }
    }

    /// Atualiza o shape_id de um nó (após re-avaliação)
    pub fn update_shape_id(&mut self, stable_id: u32, new_shape_id: i32) {
        if let Some(&idx) = self.id_map.get(&stable_id) {
            if let Some(old_sid) = self.graph.node_weight(idx).and_then(|n| n.shape_id) {
                self.shape_map.remove(&old_sid);
            }
            if let Some(n) = self.graph.node_weight_mut(idx) {
                n.shape_id = Some(new_shape_id);
            }
            self.shape_map.insert(new_shape_id, idx);
        }
    }

    // ── Serialização para o frontend ──────────────────────────────────────────

    pub fn to_json(&self) -> serde_json::Value {
        let nodes: Vec<_> = self.graph
            .node_indices()
            .filter_map(|i| self.graph.node_weight(i))
            .collect();
        let edges: Vec<_> = self.graph
            .edge_indices()
            .filter_map(|e| {
                let (a, b) = self.graph.edge_endpoints(e)?;
                let from = self.graph.node_weight(a)?.id;
                let to   = self.graph.node_weight(b)?.id;
                Some(serde_json::json!({ "from": from, "to": to }))
            })
            .collect();
        serde_json::json!({ "nodes": nodes, "edges": edges })
    }
}
