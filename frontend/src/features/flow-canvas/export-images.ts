/**
 * Saving images of the Workspace as files to use outside the app (docs/specs/flow-canvas.md 「画像の書き出し」):
 * a window first lets the names be edited (one image: its file name; several: the zip's name and each image's name
 * in it, also all at once with numbers: 「連番を付ける」; the extension stays), then one image is downloaded as it is,
 * several side by side in one zip. The names
 * start as shared/utils/archives.ts imageFileName (and confeito-images-<stamp>.zip).
 */
import { exportImages, extractArchiveFile, splitArchiveKey } from '../../shared/api/archives';
import { h } from '../../shared/ui/dom';
import { button } from '../../shared/ui/form';
import { showError, showToast } from '../../shared/ui/toast';
import { openWindow } from '../../shared/ui/window';
import {
  exportFileName,
  exportNameErrors,
  imageFileName,
  serialNames,
  splitFileName,
} from '../../shared/utils/archives';
import { fileStamp } from '../../shared/utils/datetime';
import { downloadBlob } from '../../shared/utils/download';
import { thumbnailUrl } from './thumbnails';

/** One name to edit: its field (the stem), the extension that stays, and where its error goes. */
interface NameField {
  input: HTMLInputElement;
  ext: string;
  error: HTMLElement;
}

const nameField = (name: string, label: string, key?: string): { field: NameField; row: HTMLElement } => {
  const { stem, ext } = splitFileName(name);
  const input = h('input', { class: 'cs-input export-names__input', type: 'text', value: stem });
  const error = h('div', { class: 'cs-modal__error' });
  const thumb = key ? h('img', { class: 'export-names__thumb', alt: '', draggable: false }) : null;
  if (thumb && key) void thumbnailUrl(key).then(url => url && (thumb.src = url));
  const row = h(
    'label',
    { class: 'export-names__row' },
    thumb,
    h(
      'span',
      { class: 'export-names__field' },
      h('span', { class: 'cs-field__label', text: label }),
      h('span', { class: 'export-names__name' }, input, h('span', { class: 'export-names__ext', text: ext })),
      error,
    ),
  );
  return { field: { input, ext, error }, row };
};

/**
 * 「まとめて変更」: while a name is typed, every image is named with it, numbered in order from 01
 * (shared/utils/archives.ts serialNames: the "#"s become the number, else "_01" … goes after it); emptied, the names
 * the images had come back. Each name can still be edited afterwards.
 */
const serialRow = (fields: NameField[]): HTMLElement => {
  const base = h('input', { class: 'cs-input export-names__base', type: 'text', placeholder: '例: 第1話_コマ' });
  const before = fields.map(f => f.input.value);
  base.addEventListener('input', () => {
    const name = base.value.trim();
    const names = name ? serialNames(name, 1, fields.length) : before;
    fields.forEach((f, i) => {
      f.input.value = names[i];
      f.error.textContent = '';
    });
  });
  // Enter here does not export (the names are already set while typing).
  base.addEventListener('keydown', e => {
    if (e.key === 'Enter') e.stopPropagation();
  });
  return h(
    'label',
    { class: 'export-names__serial' },
    h('span', { class: 'cs-field__label', text: 'まとめて変更（連番）' }),
    base,
    h('div', {
      class: 'export-names__hint',
      text: '入れた名前に 01 からの番号を付けて、全部の画像の名前にします。「#」の位置に番号が入ります（## で 01, 02 …）。「#」がなければ後ろに _01, _02 … を付けます。',
    }),
  );
};

/** Opens the window to name the export of `keys`, and downloads once 書き出し is pressed. */
export function downloadImages(keys: readonly string[]): void {
  if (!keys.length) return;
  const single = keys.length === 1;
  const win = openWindow({ title: '画像の書き出し', className: 'export-names' });
  const zip = single ? null : nameField(`confeito-images-${fileStamp()}.zip`, 'zip の名前');
  const images = keys.map((key, i) => nameField(imageFileName(key), single ? 'ファイル名' : `画像 ${i + 1}`, key));
  win.body.append(
    ...(zip
      ? [
          zip.row,
          serialRow(images.map(i => i.field)),
          h('div', { class: 'export-names__list-label', text: `zip に入れる画像（${keys.length} 枚）` }),
        ]
      : []),
    h('div', { class: 'export-names__list' }, ...images.map(i => i.row)),
  );

  let busy = false;
  const submit = async () => {
    if (busy) return;
    const fields = images.map(i => i.field);
    const errors = exportNameErrors(fields.map(f => ({ stem: f.input.value, ext: f.ext })));
    const zipError = zip && !zip.field.input.value.trim() ? 'ファイル名を入力してください' : null;
    fields.forEach((f, i) => (f.error.textContent = errors[i] ?? ''));
    if (zip) zip.field.error.textContent = zipError ?? '';
    if (zipError || errors.some(Boolean)) return;
    busy = true;
    run.disabled = true;
    const names = fields.map(f => exportFileName(f.input.value, f.ext));
    try {
      if (single) {
        const [archive, path] = splitArchiveKey(keys[0]);
        downloadBlob(await extractArchiveFile(archive, path), names[0]);
        showToast(`${names[0]} を書き出しました`, 'success');
      } else {
        const file = await exportImages([...keys], names, exportFileName(zip!.field.input.value, zip!.field.ext));
        downloadBlob(file.blob, file.name);
        showToast(`画像 ${keys.length} 枚を ${file.name} に書き出しました`, 'success');
      }
      win.close();
    } catch (err) {
      showError('画像を書き出せませんでした', err);
    } finally {
      busy = false;
      run.disabled = false;
    }
  };
  const run = button('書き出し', () => void submit(), { variant: 'primary', size: 'dialog' });
  win.footer(
    button('キャンセル', () => win.close(), { variant: 'outline', size: 'dialog' }),
    run,
  );
  win.body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) void submit();
  });
  (zip?.field.input ?? images[0].field.input).select();
}
