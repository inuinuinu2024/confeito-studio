/**
 * Reference image drop zones ("Object", "Character", "Style") for the Gemini tools.
 *
 * Images of every zone live in ONE ordered list owned by the tool instance, so they survive
 * closing/reopening the settings sidebar. The badge number is the position in that list,
 * which is also the "# Image N" index used in the prompt.
 */
import { DocumentManager } from '../../document/DocumentManager';
import { h } from '../../../shared/ui/dom';
import { button, helpIcon } from '../../../shared/ui/form';
import { canvasToBlob } from '../../../shared/utils/image';

export interface ReferenceImage {
  file: File;
  /** Title of the zone the image was added to, e.g. "スタイル参照 (Style)". */
  zoneTitle: string;
  isImportant?: boolean;
}

export interface ZoneDef {
  title: string;
  max: number;
}

const HELP_TEXTS: [keyword: string, text: string][] = [
  ['Object', '例: 線画、衣装のデザイン画、特定のアイテム(剣や帽子)など、形やディテールを変えたくない画像を入れます。'],
  ['Character', '例: キャラクターの三面図、顔のアップなど、人物のアイデンティティを固定したい画像を入れます。'],
  ['Style', '例: 参考にするイラストレーターの絵、完成形の塗り方の参考画像など、画風を適用したい画像を入れます。'],
];

/** "スタイル参照 (Style)" -> "スタイル参照" (used in the prompt text). */
export function zoneLabel(zoneTitle: string): string {
  return zoneTitle.split(' (')[0];
}

const objectUrls = new WeakMap<File, string>();
function previewUrl(file: File): string {
  let url = objectUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}

/** Renders one drop zone per definition, all backed by `images` (mutated in place). */
export function createReferenceZones(images: ReferenceImage[], zones: ZoneDef[]): HTMLElement[] {
  const renderers: (() => void)[] = [];
  const renderAll = () => renderers.forEach(render => render());

  const elements = zones.map(zone => {
    const count = h('span', { class: 'cs-dropzone__count' });
    const area = h('div', { class: 'cs-dropzone__area' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });

    const addFiles = (files: FileList | File[]) => {
      const zoneCount = images.filter(img => img.zoneTitle === zone.title).length;
      const accepted = Array.from(files)
        .filter(f => f.type.startsWith('image/'))
        .slice(0, zone.max - zoneCount);
      for (const file of accepted) images.push({ file, zoneTitle: zone.title });
      renderAll();
    };

    const addCanvas = async () => {
      const canvas = DocumentManager.getInstance().getCurrentCanvas();
      if (!canvas) return;
      const blob = await canvasToBlob(canvas, 'image/png');
      if (blob) addFiles([new File([blob], `canvas_${Date.now()}.png`, { type: 'image/png' })]);
    };

    const thumbnail = (item: ReferenceImage) => {
      const star = h('button', {
        class: `cs-thumb__star${item.isImportant ? ' cs-thumb__star--on' : ''}`,
        text: '★',
        title: '重要画像に設定',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          item.isImportant = !item.isImportant;
          star.classList.toggle('cs-thumb__star--on', !!item.isImportant);
        },
      });
      const remove = h('button', {
        class: 'cs-thumb__remove',
        text: '×',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          const index = images.indexOf(item);
          if (index !== -1) images.splice(index, 1);
          renderAll();
        },
      });
      return h(
        'div',
        { class: 'cs-thumb' },
        h('img', { src: previewUrl(item.file) }),
        h('div', { class: 'cs-thumb__badge', text: String(images.indexOf(item) + 1) }),
        star,
        remove,
      );
    };

    renderers.push(() => {
      const zoneImages = images.filter(img => img.zoneTitle === zone.title);
      count.textContent = `${zoneImages.length} / ${zone.max}`;
      area.replaceChildren();
      if (zoneImages.length === 0) {
        area.append(h('div', { class: 'cs-dropzone__placeholder', text: 'クリック または 画像をドラッグ＆ドロップ' }));
        return;
      }
      area.append(...zoneImages.map(thumbnail));
      if (zoneImages.length < zone.max) area.append(h('div', { class: 'cs-thumb cs-thumb--add', text: '+' }));
    });

    area.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files) addFiles(fileInput.files);
      fileInput.value = '';
    });
    area.addEventListener('dragover', e => {
      e.preventDefault();
      area.classList.add('cs-dropzone__area--dragover');
    });
    area.addEventListener('dragleave', () => area.classList.remove('cs-dropzone__area--dragover'));
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('cs-dropzone__area--dragover');
      if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
    });

    const help = HELP_TEXTS.find(([keyword]) => zone.title.includes(keyword))?.[1] ?? '';
    return h(
      'div',
      { class: 'cs-field' },
      h(
        'div',
        { class: 'cs-dropzone__header' },
        h(
          'div',
          { class: 'cs-field__label-row' },
          h('label', { class: 'cs-field__label', text: zone.title }),
          helpIcon(help),
        ),
        h(
          'div',
          { class: 'cs-dropzone__header-right' },
          button('キャンバス追加', () => void addCanvas(), { size: 'small' }),
          count,
        ),
      ),
      area,
      fileInput,
    );
  });

  renderAll();
  return elements;
}
