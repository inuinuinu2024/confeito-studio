/** Canvas background colour picker (View > Background Color..., Ctrl+B). */
import { emit } from '../../../shared/events';
import { createModal } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button } from '../../../shared/ui/form';
import { showToast } from '../../../shared/ui/toast';

/** `checkerboard` is a special value understood by the canvas renderer. */
const COLORS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Light Gray', value: '#B3B3B3' },
  { label: 'Dark Gray', value: '#666666' },
  { label: 'Black', value: '#000000' },
  { label: 'Checkerboard', value: 'checkerboard' },
  { label: 'Blue', value: '#0000FF' },
  { label: 'Green', value: '#00FF00' },
  { label: 'Red', value: '#FF0000' },
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
        showToast(`Background set to ${color.label}`, 'success');
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
