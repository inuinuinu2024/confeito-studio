/**
 * The images of the character in the editor (docs/specs/character-manager.md 「編集欄」): an add area
 * (click to choose files, or drag & drop) and one card per image: the thumbnail (reordered by dragging,
 * removed with ×, shown large in a window when clicked) and the image's own prompt text.
 * Changes stay in the editor until 保存: an image is a saved file of the character or a new file.
 * `sources()` gives the images to the icon cropper; `onAdded` reports the index of the first added image.
 */
import { characterImageUrl, fetchCharacterImage } from '../../shared/api/characters';
import { h, icon } from '../../shared/ui/dom';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { openImageViewer } from '../../shared/ui/image-viewer';
import { showToast } from '../../shared/ui/toast';
import { CHARACTER_IMAGE_TYPES, type EditorImage, isCharacterImage } from '../../shared/utils/characters';
import type { CropSource } from './icon-cropper';

export type { EditorImage } from '../../shared/utils/characters';

export interface ImageList {
  el: HTMLElement;
  /** Shows the images of character `id` (null for a new one). */
  set(id: string | null, images: EditorImage[]): void;
  get(): EditorImage[];
  /** The images as sources of the icon cropper, in order. */
  sources(): CropSource[];
}

export function createImageList(onChange: () => void, onAdded: (firstIndex: number) => void): ImageList {
  let characterId: string | null = null;
  let images: EditorImage[] = [];
  /** Object URLs of the new files shown, revoked when the editor shows other images. */
  let objectUrls = new Map<File, string>();

  const label = h('label', { class: 'cs-field__label' });
  const fileInput = h('input', { type: 'file', accept: CHARACTER_IMAGE_TYPES.join(','), multiple: true, hidden: true });
  const addArea = h('div', {
    class: 'cs-dropzone__area cm-images__add',
    text: 'クリック または 画像をドラッグ＆ドロップで追加（PNG / JPEG / WebP）',
  });
  const grid = h('div', { class: 'cm-images__grid' });
  const tiles = new Map<HTMLElement, EditorImage>();

  const urlOf = (image: EditorImage) => {
    if ('saved' in image) return characterImageUrl(characterId ?? '', image.saved);
    let url = objectUrls.get(image.file);
    if (!url) {
      url = URL.createObjectURL(image.file);
      objectUrls.set(image.file, url);
    }
    return url;
  };

  function render(): void {
    label.textContent = `画像（${images.length} 枚）`;
    tiles.clear();
    grid.replaceChildren(
      ...images.map((image, i) => {
        const name = nameOf(image, i);
        const text = h('textarea', {
          class: 'cm-image__text',
          rows: 3,
          value: image.text,
          placeholder: 'この画像の本文（任意）',
          title: `${name}の本文（ツールで使う時、この画像の説明に入ります）`,
        });
        const tile = h(
          'div',
          { class: 'cm-image', draggable: true },
          h(
            'div',
            { class: 'cm-image__thumb', title: `${name}（クリックで拡大・ドラッグで並べ替え）` },
            h('img', {
              src: urlOf(image),
              alt: name,
              draggable: false,
              onclick: () => openImageViewer(urlOf(image), name),
            }),
            'file' in image ? h('span', { class: 'cm-image__new', text: '新規' }) : null,
            h(
              'button',
              {
                class: 'cm-image__remove',
                title: '外す',
                onclick: () => {
                  images.splice(images.indexOf(image), 1);
                  render();
                  onChange();
                },
              },
              icon('close', 14),
            ),
          ),
          text,
        );
        // Typing or selecting in the text must not start dragging the card.
        text.addEventListener('focus', () => (tile.draggable = false));
        text.addEventListener('blur', () => (tile.draggable = true));
        text.addEventListener('input', () => {
          image.text = text.value;
          onChange();
        });
        tiles.set(tile, image);
        return tile;
      }),
    );
    grid.hidden = images.length === 0;
  }

  function addFiles(files: FileList | File[]): void {
    const all = Array.from(files);
    const accepted = all.filter(isCharacterImage);
    if (accepted.length < all.length) {
      showToast(`PNG / JPEG / WebP 以外の ${all.length - accepted.length} 件は追加しませんでした`, 'warning');
    }
    if (accepted.length === 0) return;
    const firstIndex = images.length;
    images.push(...accepted.map(file => ({ file, text: '' })));
    render();
    onChange();
    onAdded(firstIndex);
  }

  const nameOf = (image: EditorImage, i: number) => ('saved' in image ? `画像 ${i + 1}` : image.file.name);

  addArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = '';
  });
  addArea.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    addArea.classList.add('cs-dropzone__area--dragover');
  });
  addArea.addEventListener('dragleave', () => addArea.classList.remove('cs-dropzone__area--dragover'));
  addArea.addEventListener('drop', e => {
    e.preventDefault();
    addArea.classList.remove('cs-dropzone__area--dragover');
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  enableDragSort(
    grid,
    '.cm-image',
    order => {
      images = order.map(tile => tiles.get(tile)!);
      render();
      onChange();
    },
    'x',
  );

  render();
  return {
    el: h('div', { class: 'cs-field cm-images' }, label, addArea, fileInput, grid),
    set(id, next) {
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls = new Map();
      characterId = id;
      // Copies: typing changes the texts here, never the saved state the editor compares with.
      images = next.map(image => ({ ...image }));
      render();
    },
    get: () => images.map(image => ({ ...image })),
    sources: () =>
      images.map((image, i) => {
        const id = characterId ?? '';
        return {
          thumb: urlOf(image),
          label: nameOf(image, i),
          load: () => ('saved' in image ? fetchCharacterImage(id, image.saved) : Promise.resolve(image.file)),
        };
      }),
  };
}
