// param-editor.ts — Painel flutuante de edição de parâmetros (Fase 3.1)
// Abre quando o usuário dá duplo-clique num item da Árvore de Cena.

import { invoke } from '@tauri-apps/api/core';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ParamField {
  key: string;
  label: string;
  value: number;
  min: number;
  step: number;
}

// Descrição dos campos para cada tipo de operação
const OP_FIELDS: Record<string, ParamField[]> = {
  box:      [
    { key: 'width',  label: 'Largura',  value: 10, min: 0.1, step: 1 },
    { key: 'height', label: 'Altura',   value: 10, min: 0.1, step: 1 },
    { key: 'depth',  label: 'Profund.', value: 10, min: 0.1, step: 1 },
  ],
  cylinder: [
    { key: 'radius', label: 'Raio',   value: 5,  min: 0.1, step: 0.5 },
    { key: 'height', label: 'Altura', value: 10, min: 0.1, step: 1   },
  ],
  sphere: [
    { key: 'radius', label: 'Raio', value: 5, min: 0.1, step: 0.5 },
  ],
  cone: [
    { key: 'radius_bottom', label: 'R. Base', value: 5,  min: 0.1, step: 0.5 },
    { key: 'radius_top',    label: 'R. Topo', value: 0,  min: 0,   step: 0.5 },
    { key: 'height',        label: 'Altura',  value: 10, min: 0.1, step: 1   },
  ],
  fillet:  [{ key: 'radius',    label: 'Raio',      value: 1, min: 0.01, step: 0.5 }],
  chamfer: [{ key: 'dist',      label: 'Distância', value: 1, min: 0.01, step: 0.5 }],
  shell:   [{ key: 'thickness', label: 'Espessura', value: 1, min: 0.01, step: 0.5 }],
};

// ─── ParamEditor ─────────────────────────────────────────────────────────────

export type OnUpdateCallback = (updatedMeshes: { shape_id: number; mesh: { vertices: number[]; indices: number[] } }[]) => void;

export class ParamEditor {
  private el: HTMLElement;
  private onUpdate: OnUpdateCallback;

  constructor(containerId: string, onUpdate: OnUpdateCallback) {
    this.el = document.getElementById(containerId) as HTMLElement;
    this.onUpdate = onUpdate;
  }

  /** Abre o painel para um nó do DAG.
   *  @param nodeId    ID estável do nó no DAG (u32 do Rust)
   *  @param opType    tipo da operação ('box', 'cylinder', etc.)
   *  @param currentParams  parâmetros atuais do nó para pré-preencher os campos
   *  @param label    label do nó para exibição
   */
  open(nodeId: number, opType: string, currentParams: Record<string, number>, label: string): void {
    const fields = OP_FIELDS[opType];
    if (!fields) {
      // Operação sem parâmetros editáveis (ex: Union, Clone)
      this.el.innerHTML = `<div class="pe-no-params">⚙ "${label}" não tem parâmetros editáveis</div>`;
      this.el.classList.add('open');
      return;
    }

    // Preenche valores atuais nos campos
    const filled = fields.map(f => ({ ...f, value: currentParams[f.key] ?? f.value }));

    this.el.innerHTML = `
      <div class="pe-header">
        <span class="pe-title">✏ ${label}</span>
        <button class="pe-close" id="pe-close-btn">✕</button>
      </div>
      <div class="pe-fields">
        ${filled.map(f => `
          <label class="pe-field">
            <span>${f.label}</span>
            <input type="number" id="pe-${f.key}" value="${f.value}"
                   min="${f.min}" step="${f.step}"/>
          </label>
        `).join('')}
      </div>
      <div class="pe-footer">
        <button class="pe-apply" id="pe-apply-btn">✔ Aplicar</button>
        <button class="pe-cancel" id="pe-cancel-btn">Cancelar</button>
      </div>
      <div class="pe-status" id="pe-status"></div>`;

    this.el.classList.add('open');

    document.getElementById('pe-close-btn')!.onclick  = () => this.close();
    document.getElementById('pe-cancel-btn')!.onclick = () => this.close();
    document.getElementById('pe-apply-btn')!.onclick  = () => this.applyParams(nodeId, filled);
  }

  close(): void {
    this.el.classList.remove('open');
  }

  private async applyParams(nodeId: number, fields: ParamField[]): Promise<void> {
    const statusEl = document.getElementById('pe-status')!;
    const params: Record<string, number> = {};
    for (const f of fields) {
      const input = document.getElementById(`pe-${f.key}`) as HTMLInputElement;
      params[f.key] = parseFloat(input.value);
    }

    statusEl.textContent = '⏳ Recalculando…';
    const applyBtn = document.getElementById('pe-apply-btn') as HTMLButtonElement;
    applyBtn.disabled = true;

    try {
      const result = await invoke<{ updated: { shape_id: number; mesh: { vertices: number[]; indices: number[] } }[] }>(
        'update_param', { nodeId, params }
      );
      statusEl.textContent = `✅ ${result.updated.length} shape(s) atualizados`;
      this.onUpdate(result.updated);
      setTimeout(() => this.close(), 800);
    } catch (err) {
      statusEl.textContent = `❌ Erro: ${err instanceof Error ? err.message : String(err)}`;
      applyBtn.disabled = false;
    }
  }
}
