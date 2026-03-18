// src/scene-tree.ts — Árvore de Objetos da Cena (Fase 3.2)
// Gerencia a representação hierárquica (estilo Fusion 360) de todos os objetos 3D.

export interface SceneNode {
  id:       string;               // único: 'shape-42' ou 'folder-3'
  kind:     'shape' | 'folder';
  name:     string;               // nome editável
  shapeId?: number;               // só para kind='shape'
  icon?:    string;               // emoji do tipo
  children: SceneNode[];          // sub-itens (apenas folders)
  parentId: string | null;
}

// ─── Estado interno ──────────────────────────────────────────────────────────
let _nodeSeq  = 0;
const _nodes: Map<string, SceneNode> = new Map();
const _roots: SceneNode[] = [];   // nós de nível superior (sem parent)

let _selectedId: string | null = null;

// Callbacks externos
export let onSceneSelect: ((node: SceneNode) => void)         | null = null;
export let onSceneDelete: ((node: SceneNode) => void)         | null = null;
export let onSceneRename: ((node: SceneNode, name: string) => void) | null = null;

export function setSceneCallbacks(
  sel: (n: SceneNode) => void,
  del: (n: SceneNode) => void,
  ren: (n: SceneNode, name: string) => void,
) {
  onSceneSelect = sel;
  onSceneDelete = del;
  onSceneRename = ren;
}

// ─── API pública ─────────────────────────────────────────────────────────────

export function sceneAddShape(shapeId: number, name: string, icon = '📦', parentId: string | null = null): SceneNode {
  const node: SceneNode = {
    id: `shape-${++_nodeSeq}`, kind: 'shape',
    name, shapeId, icon, children: [], parentId,
  };
  _nodes.set(node.id, node);
  _insertNode(node, parentId);
  renderSceneTree();
  return node;
}

export function sceneAddFolder(name = 'Nova Pasta', parentId: string | null = null): SceneNode {
  const node: SceneNode = {
    id: `folder-${++_nodeSeq}`, kind: 'folder',
    name, icon: '📁', children: [], parentId,
  };
  _nodes.set(node.id, node);
  _insertNode(node, parentId);
  renderSceneTree();
  return node;
}

export function sceneRemoveShape(shapeId: number): void {
  for (const [id, node] of _nodes) {
    if (node.shapeId === shapeId) { sceneRemoveNode(id); return; }
  }
}

export function sceneRemoveNode(nodeId: string): void {
  const node = _nodes.get(nodeId);
  if (!node) return;
  if (node.parentId) {
    const parent = _nodes.get(node.parentId);
    if (parent) parent.children = parent.children.filter(c => c.id !== nodeId);
  } else {
    const idx = _roots.indexOf(node);
    if (idx >= 0) _roots.splice(idx, 1);
  }
  _deleteSubtree(node);
  renderSceneTree();
}

function _deleteSubtree(node: SceneNode): void {
  for (const child of node.children) _deleteSubtree(child);
  _nodes.delete(node.id);
}

export function sceneRenameNode(nodeId: string, name: string): void {
  const node = _nodes.get(nodeId);
  if (!node) return;
  node.name = name;
  onSceneRename?.(node, name);
  renderSceneTree();
}

export function sceneSelectById(nodeId: string | null): void {
  _selectedId = nodeId;
  renderSceneTree();
}

export function sceneGetSelected(): SceneNode | null {
  return _selectedId ? (_nodes.get(_selectedId) ?? null) : null;
}

export function sceneGetByShapeId(shapeId: number): SceneNode | null {
  for (const node of _nodes.values()) {
    if (node.shapeId === shapeId) return node;
  }
  return null;
}

/** Renomeia o node correspondente a shapeId */
export function sceneRenameShape(shapeId: number, name: string): void {
  const node = sceneGetByShapeId(shapeId);
  if (node) { node.name = name; renderSceneTree(); }
}

export function sceneAll(): SceneNode[] { return [..._nodes.values()]; }
export function sceneClear(): void { _nodes.clear(); _roots.length = 0; _selectedId = null; renderSceneTree(); }

/** Serializa toda a árvore para salvar em projeto */
export function sceneSerialize(): object {
  return { roots: JSON.parse(JSON.stringify(_roots)), seq: _nodeSeq };
}

// ─── Helpers internos ─────────────────────────────────────────────────────────
function _insertNode(node: SceneNode, parentId: string | null): void {
  if (parentId) {
    const parent = _nodes.get(parentId);
    if (parent && parent.kind === 'folder') { parent.children.push(node); return; }
  }
  _roots.push(node);
}

// ─── Renderização ─────────────────────────────────────────────────────────────
let _editingId: string | null = null;

export function renderSceneTree(): void {
  const ul = document.getElementById('scene-tree');
  if (!ul) return;

  // Remove tudo exceto o item de projeto fixo
  const projectLi = document.getElementById('tree-project-label');
  ul.innerHTML = '';
  if (projectLi) ul.appendChild(projectLi);

  if (_roots.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hist-empty';
    empty.textContent = 'Nenhum objeto na cena';
    ul.appendChild(empty);
    return;
  }

  for (const node of _roots) {
    ul.appendChild(_buildNodeEl(node, 0));
  }
}

function _buildNodeEl(node: SceneNode, depth: number): HTMLElement {
  if (node.kind === 'folder') {
    return _buildFolderEl(node, depth);
  }
  return _buildShapeEl(node, depth);
}

function _buildShapeEl(node: SceneNode, depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'tree-item' + (node.id === _selectedId ? ' selected' : '');
  li.style.paddingLeft = `${8 + depth * 14}px`;
  li.dataset.nodeId = node.id;

  const icon = document.createElement('span');
  icon.className = 'tree-item-icon';
  icon.textContent = node.icon ?? '📦';

  const nameEl = document.createElement('span');
  nameEl.className = 'tree-item-name';

  if (_editingId === node.id) {
    const inp = document.createElement('input');
    inp.value = node.name;
    inp.onclick = e => e.stopPropagation();
    const commit = () => {
      _editingId = null;
      sceneRenameNode(node.id, inp.value.trim() || node.name);
    };
    inp.addEventListener('blur',   commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { _editingId = null; renderSceneTree(); } });
    nameEl.appendChild(inp);
    setTimeout(() => inp.focus(), 30);
  } else {
    nameEl.textContent = node.name;
    nameEl.addEventListener('dblclick', e => { e.stopPropagation(); _editingId = node.id; renderSceneTree(); });
  }

  const idBadge = document.createElement('span');
  idBadge.className = 'tree-item-id';
  idBadge.textContent = node.shapeId != null ? `#${node.shapeId}` : '';

  const actions = document.createElement('div');
  actions.className = 'tree-item-actions';
  const btnDel = document.createElement('button');
  btnDel.textContent = '🗑'; btnDel.title = 'Deletar';
  btnDel.onclick = e => { e.stopPropagation(); onSceneDelete?.(node); sceneRemoveNode(node.id); };
  actions.appendChild(btnDel);

  li.appendChild(icon); li.appendChild(nameEl); li.appendChild(idBadge); li.appendChild(actions);
  li.addEventListener('click', () => {
    _selectedId = node.id;
    renderSceneTree();
    onSceneSelect?.(node);
  });
  return li;
}

function _buildFolderEl(node: SceneNode, depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'tree-folder';

  const toggle = document.createElement('button');
  toggle.className = 'tree-folder-toggle';
  toggle.style.paddingLeft = `${8 + depth * 14}px`;

  if (_editingId === node.id) {
    const inp = document.createElement('input');
    inp.value = node.name; inp.style.cssText = 'flex:1';
    inp.onclick = e => e.stopPropagation();
    const commit = () => { _editingId = null; sceneRenameNode(node.id, inp.value.trim() || node.name); };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { _editingId = null; renderSceneTree(); } });
    toggle.appendChild(inp);
    setTimeout(() => inp.focus(), 30);
  } else {
    toggle.textContent = `📁 ${node.name}`;
    toggle.addEventListener('dblclick', e => { e.stopPropagation(); _editingId = node.id; renderSceneTree(); });
  }

  let collapsed = false;
  toggle.addEventListener('click', () => { collapsed = !collapsed; body.classList.toggle('collapsed', collapsed); toggle.classList.toggle('collapsed', collapsed); });

  const body = document.createElement('ul');
  body.className = 'tree-folder-body';
  for (const child of node.children) {
    body.appendChild(_buildNodeEl(child, depth + 1));
  }

  li.appendChild(toggle); li.appendChild(body);
  return li;
}
