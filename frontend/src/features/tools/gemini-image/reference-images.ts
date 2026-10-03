/**
 * Reference image list of the Gemini tools (docs/specs/tools/gemini-image.md 「参照画像」).
 *
 * One add area (click to choose files, or drag & drop) and one card per image, in "# Image N"
 * order. Each card sets the image's type (Object / Character / Style — any type the model has),
 * the ★ "important" flag and a description, and is reordered by dragging its handle.
 * Only the total number of images is limited; the per-type numbers are recommendations.
 * The images live in an array owned by the tool instance, so they survive closing the tool window.
 */
import './reference-images.css';
import { h, icon } from '../../../shared/ui/dom';
import { enableDragSort } from '../../../shared/ui/drag-sort';
import { helpIcon } from '../../../shared/ui/form';
import { showToast } from '../../../shared/ui/toast';
import {
  countInZone,
  type ReferenceImage,
  reorderImages,
  totalLimit,
  type ZoneDef,
  zoneForNewImage,
  zoneShortName,
} from './reference-list';

export type { ReferenceImage, ZoneDef } from './reference-list';

const TYPE_HELP = [
  '画像ごとに種類を選びます。種類ごとの数（例: Object 2/6）は Gemini の推奨枚数の目安で、超えても送れます。',
  '上限があるのは合計の枚数だけです。',
  'Object: 線画、衣装のデザイン画、特定のアイテム(剣や帽子)など、形やディテールを変えたくない画像。',
  'Character: キャラクターの三面図、顔のアップなど、人物のアイデンティティを固定したい画像。',
  'Style: 参考にするイラストレーターの絵、完成形の塗り方の参考画像など、画風を適用したい画像。',
  '説明は Gemini に送る文章で、その画像の見出し（# Image N）の下に入ります。',
].join('\n');

const objectUrls = new WeakMap<File, string>();
function previewUrl(file: File): string {
  let url = objectUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}

/**
 * Renders the list backed by `images` (mutated in place); `zones` are the model's types and recommended
 * numbers, `limit` the total number of images allowed (by default the sum of the recommended numbers).
 */
export function createReferenceList(
  images: ReferenceImage[],
  zones: ZoneDef[],
  limit = totalLimit(zones),
): HTMLElement {
  const counts = h('div', { class: 'ref-list__counts' });
  const addArea = h('div', { class: 'cs-dropzone__area ref-list__add' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const list = h('div', { class: 'ref-list' });
  const cardImages = new Map<HTMLElement, ReferenceImage>();

  const addFiles = (files: FileList | File[]) => {
    let skipped = 0;
    for (const file of Array.from(files).filter(f => f.type.startsWith('image/'))) {
      const zone = zoneForNewImage(images, zones, limit);
      if (zone) images.push({ file, zoneTitle: zone.title });
      else skipped++;
    }
    if (skipped)
      showToast(`参照画像の上限（合計 ${limit} 枚）に達したため、${skipped} 枚は追加しませんでした`, 'warning');
    render();
  };

  const card = (item: ReferenceImage, index: number) => {
    const handle = h('span', {
      class: 'material-symbols-outlined ref-card__handle',
      text: 'drag_indicator',
      title: 'ドラッグで並べ替え',
    });
    const star = h('button', {
      class: `ref-card__star${item.isImportant ? ' ref-card__star--on' : ''}`,
      text: '★',
      title: '重要画像に設定',
      onclick: () => {
        item.isImportant = !item.isImportant;
        star.classList.toggle('ref-card__star--on', !!item.isImportant);
      },
    });
    const remove = h(
      'button',
      {
        class: 'ref-card__remove',
        title: '削除',
        onclick: () => {
          images.splice(images.indexOf(item), 1);
          render();
        },
      },
      icon('close', 16),
    );
    const type = h(
      'select',
      { class: 'cs-select ref-card__type', title: '種類' },
      ...zones.map(zone => h('option', { value: zone.title, text: zone.title })),
    );
    type.value = item.zoneTitle;
    type.addEventListener('change', () => {
      item.zoneTitle = type.value;
      render();
    });
    const description = h('textarea', {
      class: 'cs-textarea ref-card__description',
      rows: 2,
      placeholder: '画像の説明（任意）',
      value: item.description ?? '',
    });
    description.addEventListener('input', () => (item.description = description.value));

    const el = h(
      'div',
      { class: 'ref-card' },
      h('div', { class: 'ref-card__thumb' }, h('img', { src: previewUrl(item.file), alt: item.file.name })),
      h(
        'div',
        { class: 'ref-card__main' },
        h(
          'div',
          { class: 'ref-card__head' },
          handle,
          h('span', { class: 'ref-card__name', text: `Image ${index + 1}` }),
          star,
          remove,
        ),
        type,
        description,
      ),
    );
    // Only the handle starts a drag, so text in the description can still be selected.
    handle.addEventListener('pointerdown', () => (el.draggable = true));
    handle.addEventListener('pointerup', () => (el.draggable = false));
    el.addEventListener('dragend', () => (el.draggable = false));
    cardImages.set(el, item);
    return el;
  };

  function render(): void {
    const full = images.length >= limit;
    counts.replaceChildren(
      h('span', {
        class: `ref-list__count ref-list__count--total${full ? ' ref-list__count--full' : ''}`,
        text: `合計 ${images.length}/${limit}`,
      }),
      ...zones.map(zone => {
        const used = countInZone(images, zone.title);
        return h('span', {
          class: `ref-list__count${used > zone.max ? ' ref-list__count--over' : ''}`,
          text: `${zoneShortName(zone.title)} ${used}/${zone.max}`,
          title: used > zone.max ? '推奨枚数を超えています（送ることはできます）' : '推奨枚数',
        });
      }),
    );
    addArea.classList.toggle('ref-list__add--full', full);
    addArea.textContent = full ? '上限まで追加しました' : 'クリック または 画像をドラッグ＆ドロップで追加';
    cardImages.clear();
    list.replaceChildren(...images.map(card));
    list.hidden = images.length === 0;
  }

  addArea.addEventListener('click', () => {
    if (images.length < limit) fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = '';
  });
  addArea.addEventListener('dragover', e => {
    e.preventDefault();
    addArea.classList.add('cs-dropzone__area--dragover');
  });
  addArea.addEventListener('dragleave', () => addArea.classList.remove('cs-dropzone__area--dragover'));
  addArea.addEventListener('drop', e => {
    e.preventDefault();
    addArea.classList.remove('cs-dropzone__area--dragover');
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  enableDragSort(list, '.ref-card', cards => {
    reorderImages(
      images,
      cards.map(el => cardImages.get(el)!),
    );
    render();
  });

  render();
  return h(
    'div',
    { class: 'ref-section' },
    h(
      'div',
      { class: 'cs-field__label-row' },
      h('label', { class: 'cs-field__label', text: '参照画像' }),
      helpIcon(TYPE_HELP),
    ),
    counts,
    addArea,
    fileInput,
    list,
  );
}
