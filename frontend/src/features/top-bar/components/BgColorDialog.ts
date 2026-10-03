/** Canvas background colour picker (View > Background Color..., Ctrl+B). */
import { emit } from '../../../shared/events';
import { createModal } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button } from '../../../shared/ui/form';
import { showToast } from '../../../shared/ui/toast';

/** `checkerboard` is a special value understood by the canvas renderer. */
const COLORS = [
  { label: 'White', name: '白', value: '#FFFFFF' },
  { label: 'Light Gray', name: 'ライトグレー', value: '#B3B3B3' },
  { label: 'Dark Gray', name: 'ダークグレー', value: '#666666' },
  { label: 'Black', name: '黒', value: '#000000' },
  { label: 'Checkerboard', name: '市松模様', value: 'checkerboard' },
  { label: 'Blue', name: '青', value: '#0000FF' },
  { label: 'Green', name: '緑', value: '#00FF00' },
  { label: 'Red', name: '赤', value: '#FF0000' },
];

export function createBgColorDialog(): { open: () => void } {
  const modal = createModal({ title: 'Canvas Background Color', width: '320px', overlayClass: 'settings-overlay' });

  const swatches = COLORS.map(color =>
    h('button', {
      class: color.value === 'checkerboard' ? 'bg-swatch bg-swatch--checkerboard' : 'bg-swatch',
      title: color.label,
      style: color.value === 'checkerboard' ? undefined : { backgroundColor: color.value },
      onclick: () => {
        emit('canvas:bg-color', { color: color.value });
        showToast(`背景色を「${color.name}」に変更しました`, 'success');
        modal.close();
      },
    }),
  );

  modal.panel.append(
    h('div', { class: 'bg-swatches' }, ...swatches),
    h(
      'div',
      { class: 'cs-modal__actions' },
      button('Cancel', () => modal.close(), { variant: 'outline', size: 'dialog' }),
    ),
  );

  return { open: modal.open };
}
