// src/history.ts — Gerenciador de Histórico de Operações (Fase 3.2)
// Rastreia todas as operações CAD e as exibe num painel lateral retrátil.

export type HistOpType =
  | 'box' | 'cylinder' | 'sphere' | 'cone'
  | 'union' | 'cut' | 'intersect'
  | 'fillet' | 'chamfer' | 'shell'
  | 'transform' | 'clone' | 'delete';

export interface HistoryEntry {
  id:       number;          // id único dentro do histórico
  op:       HistOpType;
  label:    string;          // nome legível, ex: "Caixa 50×50×50"
  shapeId:  number | null;   // shape resultante (null se deletado)
  params:   Record<string, string | number>; // params resumidos
  timestamp: number;
}

const ICONS: Record<HistOpType, string> = {
  box:       '📦', cylinder: '🔵', sphere: '⚽', cone: '🔺',
  union:     '⊕',  cut:      '⊖',  intersect: '⊗',
  fillet:    '◉',  chamfer:  '◈',  shell:     '⬡',
  transform: '↗',  clone:    '⧉',  delete:    '🗑',
};

let _seq = 0;
const _entries: HistoryEntry[] = [];

/** Callbacks externos */
export let onHistorySelect: ((entry: HistoryEntry) => void) | null = null;
export let onHistoryDelete: ((entry: HistoryEntry) => void) | null = null;

export function setHistoryCallbacks(
  sel: (e: HistoryEntry) => void,
  del: (e: HistoryEntry) => void,
) {
  onHistorySelect = sel;
  onHistoryDelete = del;
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function historyAdd(
  op:      HistOpType,
  label:   string,
  shapeId: number | null,
  params:  Record<string, string | number> = {},
): HistoryEntry {
  const entry: HistoryEntry = {
    id: ++_seq, op, label, shapeId, params, timestamp: Date.now(),
  };
  _entries.push(entry);
  _renderHistory();
  return entry;
}

/** Marca uma entrada como "removida" (shape foi deletado) */
export function historyMarkDeleted(shapeId: number): void {
  for (const e of _entries) {
    if (e.shapeId === shapeId) { e.shapeId = null; _renderHistory(); }
  }
}

/** Atualiza shapeId de uma entrada (após operação in-place) */
export function historyUpdateShape(entryId: number, newShapeId: number): void {
  const e = _entries.find(x => x.id === entryId);
  if (e) { e.shapeId = newShapeId; _renderHistory(); }
}

export function historyAll(): HistoryEntry[] { return [..._entries]; }
export function historyClear(): void { _entries.length = 0; _renderHistory(); }

// ─── Rendering ───────────────────────────────────────────────────────────────

let _selectedHistId: number | null = null;

function _paramsStr(p: Record<string, string | number>): string {
  return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(' · ');
}

function _timeStr(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

export function _renderHistory(): void {
  const list = document.getElementById('history-list');
  if (!list) return;

  list.innerHTML = '';

  if (_entries.length === 0) {
    list.innerHTML = '<li class="hist-empty">Nenhuma operação ainda</li>';
    return;
  }

  // Agrupar por tipo de categoria
  const grouped: { label: string; entries: HistoryEntry[] }[] = [
    { label: '🧱 Primitivas', entries: _entries.filter(e => ['box','cylinder','sphere','cone'].includes(e.op)) },
    { label: '⊕ Booleanas',  entries: _entries.filter(e => ['union','cut','intersect'].includes(e.op)) },
    { label: '✨ Detalhes',   entries: _entries.filter(e => ['fillet','chamfer','shell'].includes(e.op)) },
    { label: '🔧 Outras',    entries: _entries.filter(e => ['transform','clone','delete'].includes(e.op)) },
  ].filter(g => g.entries.length > 0);

  for (const group of grouped) {
    const groupEl = document.createElement('li');
    groupEl.className = 'hist-group';

    const groupHeader = document.createElement('button');
    groupHeader.className = 'hist-group-toggle';
    groupHeader.setAttribute('aria-expanded', 'true');
    groupHeader.textContent = group.label;
    groupEl.appendChild(groupHeader);

    const groupBody = document.createElement('ul');
    groupBody.className = 'hist-group-body';

    for (const entry of group.entries) {
      const li = document.createElement('li');
      li.className = 'hist-entry' + (entry.id === _selectedHistId ? ' selected' : '') + (entry.shapeId === null ? ' deleted' : '');
      li.dataset.histId = String(entry.id);

      const icon = document.createElement('span');
      icon.className = 'hist-icon';
      icon.textContent = ICONS[entry.op] ?? '◆';

      const info = document.createElement('div');
      info.className = 'hist-info';

      const name = document.createElement('span');
      name.className = 'hist-name';
      name.textContent = entry.label;

      const meta = document.createElement('span');
      meta.className = 'hist-meta';
      const ps = _paramsStr(entry.params);
      meta.textContent = (ps ? ps + ' · ' : '') + _timeStr(entry.timestamp);

      info.appendChild(name);
      info.appendChild(meta);

      const badge = document.createElement('span');
      badge.className = 'hist-badge';
      badge.textContent = entry.shapeId !== null ? `#${entry.shapeId}` : '—';

      li.appendChild(icon);
      li.appendChild(info);
      li.appendChild(badge);

      li.addEventListener('click', () => {
        _selectedHistId = entry.id;
        _renderHistory();
        onHistorySelect?.(entry);
      });

      groupBody.appendChild(li);
    }

    groupHeader.addEventListener('click', () => {
      const expanded = groupHeader.getAttribute('aria-expanded') === 'true';
      groupHeader.setAttribute('aria-expanded', String(!expanded));
      groupBody.classList.toggle('collapsed', expanded);
    });

    groupEl.appendChild(groupBody);
    list.appendChild(groupEl);
  }

  // Contador no header
  const counter = document.getElementById('history-count');
  if (counter) counter.textContent = String(_entries.length);
}
