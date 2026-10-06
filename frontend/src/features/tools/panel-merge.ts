/**
 * コマ結合 — pastes the panels of a コマ分割 result back into one image, saved by the backend as a tool
 * result "<archive>/<stamp>_コマ結合/" (services/merge_service.py).
 * It runs once per コマ分割 run that a selected image comes from (a panel, or an image made from one).
 * Each panel is replaced by the image marked for it on the canvas (「結合」 on a generated image), else pasted as
 * split (flow-graph.ts `mergeChoice`). The tool window lists what will be merged and where the result goes.
 * Spec: docs/specs/tools/panel-split-merge.md
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import { mergePanels } from '../../shared/api/image';
import { emit } from '../../shared/events';
import type { FlowImage, FlowRun } from '../../shared/types/flow';
import { type RunTarget, type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { h } from '../../shared/ui/dom';
import { DocumentManager } from '../document/DocumentManager';
import {
  buildGraph,
  type FlowGraph,
  mergeChoice,
  mergeOverrides,
  SPLIT_TOOL,
  upstreamRun,
} from '../flow-canvas/flow-graph';
import { discardIfStopped } from './result';
import { missingTargetCard, saveDestinationLine } from './target-card';

const SELECT_PANEL = 'キャンバスでコマ分割の結果（コマ、またはコマから作った画像）を選択してください。';

const currentGraph = (): FlowGraph | null => {
  const flow = DocumentManager.getInstance().getFlow();
  return flow ? buildGraph(flow) : null;
};

/** The コマ分割 runs the selected images come from, in selection order (each once). */
export function splitRunsOf(graph: FlowGraph | null, selection: readonly FlowImage[]): FlowRun[] {
  const runs = new Map<string, FlowRun>();
  for (const image of selection) {
    const run = graph && upstreamRun(graph, image.key, SPLIT_TOOL);
    if (run) runs.set(run.folder, run);
  }
  return [...runs.values()];
}

/** One line about the folder's panels.json, or a warning when it is missing or broken. */
async function describePanels(folder: string): Promise<{ text: string; ok: boolean }> {
  const blob = await fetchArchiveKey(`${folder}/panels.json`);
  if (!blob) return { text: `⚠️ このコマ分割の結果に panels.json がありません。`, ok: false };
  try {
    const data = JSON.parse(await blob.text()) as {
      panels?: unknown[];
      image_size?: { width?: number; height?: number };
    };
    const size = data.image_size ? `${data.image_size.width} × ${data.image_size.height} px` : '不明';
    return { text: `コマ数: ${data.panels?.length ?? 0} / 結合後の大きさ: ${size}`, ok: true };
  } catch {
    return { text: '⚠️ panels.json を読み取れませんでした（ファイルが壊れている可能性があります）。', ok: false };
  }
}

export class PanelMergeTool implements Tool {
  id = 'panel-merge';
  name = 'コマ結合';
  executeIcon = null;

  targets(selection: readonly FlowImage[]): RunTarget[] {
    const runs = splitRunsOf(currentGraph(), selection);
    if (!runs.length) throw new ToolNotReady(SELECT_PANEL);
    return runs.map(run => ({ key: run.folder, name: run.folder.split('/').pop() ?? run.folder }));
  }

  renderSettings(container: HTMLElement): void {
    container.append(this.targetCard());
  }

  /** The コマ分割 results to merge, their panels.json, the replaced panels and where the result goes. */
  private targetCard(): HTMLElement {
    const graph = currentGraph();
    const runs = splitRunsOf(graph, DocumentManager.getInstance().getSelection());
    if (!graph || !runs.length) return missingTargetCard('結合するコマ分割の結果', SELECT_PANEL);
    const lines = runs.flatMap(run => {
      // Each panel with an image marked 「結合」, and that image.
      const replaced = run.outputs.flatMap(panel => {
        const choice = mergeChoice(graph, panel);
        if (choice.key === panel.key) return [];
        const name = graph.images.get(choice.key)?.name ?? choice.key;
        return [`${panel.name} → ${name}`];
      });
      const panels = h('div', { class: 'cs-card__line', text: 'panels.json を確認しています…' });
      void describePanels(run.folder).then(({ text, ok }) => {
        panels.textContent = text;
        if (!ok) panels.className = 'cs-card__warning';
      });
      return [
        h('div', { class: 'cs-card__line', text: `対象: ${run.folder.split('/').pop()}` }),
        panels,
        h('div', {
          class: 'cs-card__line',
          text: replaced.length
            ? `差し替えるコマ（「結合」の画像）: ${replaced.join(', ')}`
            : '差し替えるコマ: なし（分割したままのコマを貼る）',
        }),
      ];
    });
    return h(
      'div',
      { class: 'cs-card' },
      h('div', { class: 'cs-card__title', text: `結合するコマ分割: ${runs.length} 件` }),
      saveDestinationLine(this.name),
      ...lines,
    );
  }

  async execute(context: ToolContext): Promise<string> {
    const folder = context.target?.key;
    const graph = currentGraph();
    const run = folder ? graph?.runs.get(folder) : undefined;
    if (!folder || !graph || !run) throw new ToolNotReady(SELECT_PANEL);
    context.ready();

    const result = await mergePanels(folder, mergeOverrides(graph, run));
    // The backend saves the image itself, so a stopped run removes it afterwards.
    await discardIfStopped(context.signal, result.folder);
    emit('archives:changed', { select: [result.auto_select_key] });
    return `「${result.folder}」に結合画像を保存しました`;
  }
}
