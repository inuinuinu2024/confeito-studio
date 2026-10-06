/**
 * Card at the top of a tool window: what the tool will process (the images selected on the canvas, run one
 * after another) and where the result is saved (docs/specs/archives.md 「ツールの結果の保存」).
 * When nothing is selected it shows a warning instead.
 */
import type { FlowImage } from '../../shared/types/flow';
import { h, icon } from '../../shared/ui/dom';
import { SELECT_IMAGE } from '../ai-panel/run-targets';
import { DocumentManager } from '../document/DocumentManager';
import { currentArchive } from './result';

/** Warning card: "⚠️ <subject>が選択されていません" and how to select it. */
export function missingTargetCard(subject: string, hint = SELECT_IMAGE): HTMLElement {
  return h(
    'div',
    { class: 'cs-card' },
    h('div', { class: 'cs-card__warning', text: `⚠️ ${subject}が選択されていません` }),
    h('div', { class: 'cs-card__line', text: hint }),
  );
}

/** "保存先: <archive> / [日時]_<tool>/" (or a new archive when there is none). */
export function saveDestinationLine(toolName: string): HTMLElement {
  const archive = currentArchive();
  return h(
    'div',
    { class: 'cs-card__line cs-card__line--accent' },
    icon('folder', 13),
    `保存先: ${archive ? `${archive} / [日時]_${toolName}/` : `[日時]_${toolName}/ (新しいアーカイブ)`}`,
  );
}

const sizeText = (image: FlowImage) =>
  image.width && image.height ? `${image.width} × ${image.height} px` : 'サイズ不明';

/** One line per selected image (at most `max`, then "ほか N 枚"). */
export function selectionLines(images: readonly FlowImage[], max = 5): HTMLElement[] {
  const lines = images
    .slice(0, max)
    .map((image, i) => h('div', { class: 'cs-card__line', text: `${i + 1}. ${image.name}（${sizeText(image)}）` }));
  if (images.length > max) lines.push(h('div', { class: 'cs-card__line', text: `ほか ${images.length - max} 枚` }));
  return lines;
}

/** The selected images (name, size) and the save destination; `subject` names the image in the warning. */
export function imageTargetCard(toolName: string, subject: string): HTMLElement {
  const images = DocumentManager.getInstance().getSelection();
  if (!images.length) return missingTargetCard(subject);
  if (images.length === 1) {
    return h(
      'div',
      { class: 'cs-card' },
      h('div', { class: 'cs-card__title', text: `対象画像: ${images[0].name}` }),
      saveDestinationLine(toolName),
      h('div', { class: 'cs-card__line', text: `解像度: ${sizeText(images[0])}` }),
    );
  }
  return h(
    'div',
    { class: 'cs-card' },
    h('div', { class: 'cs-card__title', text: `対象画像: 選択中の ${images.length} 枚（選んだ順に 1 枚ずつ処理）` }),
    saveDestinationLine(toolName),
    ...selectionLines(images),
  );
}
