/**
 * LayerPanel — Left sidebar with layer tree and layer properties inspector.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';

interface LayerDef {
  name: string;
  iconName: string;
  isGroup?: boolean;
  isChild?: boolean;
  active?: boolean;
  badge?: string;
  spaced?: boolean;
}

const layers: LayerDef[] = [
  { name: 'Character 1',       iconName: 'folder_open', isGroup: true },
  { name: 'Inks_Clean',        iconName: 'image',       isChild: true, active: true, badge: 'Focus AI' },
  { name: 'Rough_Sketch',      iconName: 'brush',       isChild: true },
  { name: 'Background',        iconName: 'folder',      isGroup: true, spaced: true },
  { name: 'Screentones_Global', iconName: 'grid_on',     isGroup: true, spaced: true },
  { name: 'Paper_Base',        iconName: 'layers',      isGroup: true },
];

export function createLayerPanel(): HTMLElement {
  const aside = document.createElement('aside');
  aside.className = 'layer-panel';

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'layer-panel__header';

  const title = document.createElement('span');
  title.className = 'layer-panel__title';
  title.textContent = 'Layers';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'layer-panel__actions';
  const layerActions: { iconName: string; label: string }[] = [
    { iconName: 'add', label: 'レイヤー追加' },
    { iconName: 'folder', label: 'グループ作成' },
    { iconName: 'delete', label: 'レイヤー削除' },
  ];
  for (const action of layerActions) {
    const btn = document.createElement('button');
    btn.className = 'layer-panel__action-btn';
    btn.appendChild(icon(action.iconName, 16));
    btn.addEventListener('click', () => showToast(action.label));
    actions.appendChild(btn);
  }
  header.appendChild(actions);
  aside.appendChild(header);

  // ── Layer Tree ──
  const tree = document.createElement('div');
  tree.className = 'layer-tree';

  for (const layer of layers) {
    const item = document.createElement('div');
    const classes = ['layer-item'];
    if (layer.active) classes.push('layer-item--active');
    if (layer.isGroup) classes.push('layer-item--group');
    if (layer.isChild) classes.push('layer-item--child');
    if (layer.spaced) classes.push('layer-item--spaced');
    item.className = classes.join(' ');

    // Click to select
    item.addEventListener('click', () => {
      tree.querySelectorAll('.layer-item').forEach((el) => {
        el.classList.remove('layer-item--active');
      });
      item.classList.add('layer-item--active');
    });

    // Visibility icon
    const visIcon = icon('visibility', 16);
    visIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--vis';
    item.appendChild(visIcon);

    // Type icon
    const typeIcon = icon(layer.iconName, 16);
    typeIcon.className = `material-symbols-outlined layer-item__icon ${
      layer.active || layer.isGroup ? 'layer-item__icon--type-active' : 'layer-item__icon--type'
    }`;
    item.appendChild(typeIcon);

    // Name
    const name = document.createElement('span');
    name.className = 'layer-item__name';
    name.textContent = layer.name;
    if (layer.active) name.style.color = 'var(--color-on-surface)';
    item.appendChild(name);

    // Badge
    if (layer.badge) {
      const badge = document.createElement('span');
      badge.className = 'layer-item__badge';
      badge.textContent = layer.badge;
      item.appendChild(badge);
    }

    tree.appendChild(item);
  }
  aside.appendChild(tree);

  // ── Layer Properties ──
  const props = document.createElement('div');
  props.className = 'layer-props';

  const propsTitle = document.createElement('span');
  propsTitle.className = 'layer-props__title';
  propsTitle.textContent = 'Layer Properties';
  props.appendChild(propsTitle);

  // Opacity row
  const opacityRow = document.createElement('div');
  opacityRow.className = 'layer-props__row';
  const opacityLabel = document.createElement('span');
  opacityLabel.className = 'layer-props__label';
  opacityLabel.textContent = 'Opacity';
  const opacityValue = document.createElement('span');
  opacityValue.className = 'layer-props__value';
  opacityValue.textContent = '100%';
  opacityRow.appendChild(opacityLabel);
  opacityRow.appendChild(opacityValue);
  props.appendChild(opacityRow);

  // Opacity slider
  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.min = '0';
  opacitySlider.max = '100';
  opacitySlider.value = '100';
  opacitySlider.className = 'layer-props__slider';
  opacitySlider.addEventListener('input', () => {
    opacityValue.textContent = `${opacitySlider.value}%`;
  });
  props.appendChild(opacitySlider);

  // Blend Mode row
  const blendRow = document.createElement('div');
  blendRow.className = 'layer-props__row';
  const blendLabel = document.createElement('span');
  blendLabel.className = 'layer-props__label';
  blendLabel.textContent = 'Blend Mode';
  const blendSelect = document.createElement('select');
  blendSelect.className = 'layer-props__select';
  for (const mode of ['Multiply', 'Normal', 'Screen', 'Overlay', 'Soft Light']) {
    const opt = document.createElement('option');
    opt.value = mode;
    opt.textContent = mode;
    blendSelect.appendChild(opt);
  }
  blendRow.appendChild(blendLabel);
  blendRow.appendChild(blendSelect);
  props.appendChild(blendRow);

  aside.appendChild(props);

  return aside;
}
