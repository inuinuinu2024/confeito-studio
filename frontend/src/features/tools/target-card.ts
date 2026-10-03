/**
 * Card at the top of a tool window: what the tool will process and where the result is saved
 * (docs/specs/archives.md 「ツールの結果の保存」). When nothing is selected it shows a warning instead.
 */
import { h, icon } from '../../shared/ui/dom';
import { DocumentManager } from '../document/DocumentManager';
import { selectedArchive } from './result';

/** Warning card: "⚠️ <subject>が選択されていません" and how to select it. */
export function missingTargetCard(subject: string, hint = `ARCHIVES で${subject}を選択してください。`): HTMLElement {
  return h(
    'div',
    { class: 'cs-card' },
    h('div', { class: 'cs-card__warning', text: `⚠️ ${subject}が選択されていません` }),
    h('div', { class: 'cs-card__line', text: hint }),
  );
}

/** "保存先: <archive> / [日時]_<tool>/" (or a new archive when nothing is selected). */
export function saveDestinationLine(toolName: string): HTMLElement {
  const archive = selectedArchive();
  return h(
    'div',
    { class: 'cs-card__line cs-card__line--accent' },
    icon('folder', 13),
    `保存先: ${archive ? `${archive} / [日時]_${toolName}/` : `[日時]_${toolName}/ (新しいアーカイブ)`}`,
  );
}

/** The selected image (name, size) and the save destination; `subject` names the image in the warning. */
export function imageTargetCard(toolName: string, subject: string): HTMLElement {
  const docManager = DocumentManager.getInstance();
  const canvas = docManager.getCurrentCanvas();
  if (!canvas) return missingTargetCard(subject);
  return h(
    'div',
    { class: 'cs-card' },
    h('div', { class: 'cs-card__title', text: `対象画像: ${docManager.getCurrentFilename() || 'キャンバス画像'}` }),
    saveDestinationLine(toolName),
    h('div', { class: 'cs-card__line', text: `解像度: ${canvas.width} × ${canvas.height} px` }),
  );
}
