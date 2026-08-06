/**
 * LayerPanel — Left sidebar with layer tree and layer properties inspector.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import type { Psd, Layer } from 'ag-psd';

interface LayerDef {
  name: string;
  iconName: string;
  isGroup?: boolean;
  isChild?: boolean;
  depth?: number;
  active?: boolean;
  badge?: string;
  spaced?: boolean;
  hidden?: boolean;
  layer?: Layer;
}

const layers: LayerDef[] = [
  { name: 'Character 1',       iconName: 'folder_open', isGroup: true, depth: 0 },
  { name: 'Inks_Clean',        iconName: 'image',       isChild: true, depth: 1, active: true, badge: 'Focus AI' },
  { name: 'Rough_Sketch',      iconName: 'brush',       isChild: true, depth: 1 },
  { name: 'Background',        iconName: 'folder',      isGroup: true, spaced: true, depth: 0 },
  { name: 'Screentones_Global', iconName: 'grid_on',     isGroup: true, spaced: true, depth: 0 },
  { name: 'Paper_Base',        iconName: 'layers',      isGroup: true, depth: 0 },
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
    btn.addEventListener('click', () => showToast(action.label, true));
    actions.appendChild(btn);
  }
  header.appendChild(actions);
  aside.appendChild(header);

  // ── Layer Tree ──
  const tree = document.createElement('div');
  tree.className = 'layer-tree';

  const renderLayerTree = (items: LayerDef[]) => {
    tree.innerHTML = '';
    for (let i = 0; i < items.length; i++) {
      const layerDef = items[i];
      const item = document.createElement('div');
      const classes = ['layer-item'];
      if (layerDef.active) classes.push('layer-item--active');
      if (layerDef.isGroup) classes.push('layer-item--group');
      if (layerDef.isChild) classes.push('layer-item--child');
      if (layerDef.spaced) classes.push('layer-item--spaced');
      if (layerDef.hidden) classes.push('layer-item--hidden');
      item.className = classes.join(' ');

      // Click to select
      item.addEventListener('click', () => {
        const wasActive = layerDef.active;
        items.forEach((l) => (l.active = false));
        layerDef.active = !wasActive;
        renderLayerTree(items);
        
        window.dispatchEvent(new CustomEvent('layer:selected', {
          detail: { layer: layerDef.active ? layerDef.layer : null }
        }));
      });

      // Visibility icon
      const visIconName = layerDef.hidden ? 'visibility_off' : 'visibility';
      const visIcon = icon(visIconName, 16);
      visIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--vis';
      if (layerDef.hidden) {
        visIcon.style.opacity = '0.4';
        item.style.opacity = '0.6';
      }

      visIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetHidden = !layerDef.hidden;
        layerDef.hidden = targetHidden;
        if (layerDef.layer) layerDef.layer.hidden = targetHidden;

        // Toggle children if it's a group
        if (layerDef.isGroup) {
          const targetDepth = layerDef.depth || 0;
          for (let j = i + 1; j < items.length; j++) {
            const childDef = items[j];
            const childDepth = childDef.depth ?? (childDef.isChild ? 1 : 0);
            if (childDepth > targetDepth) {
              childDef.hidden = targetHidden;
              if (childDef.layer) childDef.layer.hidden = targetHidden;
            } else {
              break;
            }
          }
        }

        // Update ancestors based on children's state
        let currentItemIndex = i;
        while (true) {
          let parentIndex = -1;
          const currentDepth = items[currentItemIndex].depth || 0;
          if (currentDepth === 0) break; // No parent

          // Find the parent
          for (let k = currentItemIndex - 1; k >= 0; k--) {
            const kDepth = items[k].depth || 0;
            if (kDepth < currentDepth) {
              parentIndex = k;
              break;
            }
          }

          if (parentIndex === -1) break;

          const parentDef = items[parentIndex];
          const pDepth = parentDef.depth || 0;
          
          // Check if any direct child is visible
          let anyChildVisible = false;
          for (let j = parentIndex + 1; j < items.length; j++) {
            const childDef = items[j];
            const cDepth = childDef.depth || 0;
            if (cDepth <= pDepth) break; // End of descendants
             
            if (cDepth === pDepth + 1) {
              if (!childDef.hidden) {
                anyChildVisible = true;
                break;
              }
            }
          }

          const shouldHideParent = !anyChildVisible;
          if (!!parentDef.hidden !== shouldHideParent) {
            parentDef.hidden = shouldHideParent;
            if (parentDef.layer) parentDef.layer.hidden = shouldHideParent;
            currentItemIndex = parentIndex; // Bubble up to parent
          } else {
            break; // Stop bubbling if parent state didn't change
          }
        }

        renderLayerTree(items);
        window.dispatchEvent(new Event('document:redraw'));
      });

      item.appendChild(visIcon);

      // Type icon
      const typeIcon = icon(layerDef.iconName, 16);
      typeIcon.className = `material-symbols-outlined layer-item__icon ${
        layerDef.active || layerDef.isGroup ? 'layer-item__icon--type-active' : 'layer-item__icon--type'
      }`;
      item.appendChild(typeIcon);

      // Name
      const name = document.createElement('span');
      name.className = 'layer-item__name';
      name.textContent = layerDef.name;
      if (layerDef.active) name.style.color = 'var(--color-on-surface)';
      item.appendChild(name);

      // Badge
      if (layerDef.badge) {
        const badge = document.createElement('span');
        badge.className = 'layer-item__badge';
        badge.textContent = layerDef.badge;
        item.appendChild(badge);
      }

      tree.appendChild(item);
    }
  };

  // Initial render with dummy data
  renderLayerTree(layers);

  // Listen for PSD loaded event
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: Psd; filename: string }>;
    const psd = customEvent.detail.psd;
    const filename = customEvent.detail.filename;

    title.textContent = filename;

    if (psd.children) {
      const mappedLayers = mapPsdLayers(psd.children);
      renderLayerTree(mappedLayers);
    }
  });
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

function mapPsdLayers(psdLayers: Layer[], depth = 0): LayerDef[] {
  const result: LayerDef[] = [];
  
  // ag-psd returns layers in order from bottom to top (like Photoshop internal).
  // Usually UI layer lists are top to bottom. So we iterate backwards.
  for (let i = psdLayers.length - 1; i >= 0; i--) {
    const layer = psdLayers[i];
    const isGroup = layer.children !== undefined;
    
    result.push({
      name: layer.name || 'Unnamed Layer',
      iconName: isGroup ? 'folder' : (layer.canvas || layer.imageData ? 'image' : 'layers'),
      isGroup: isGroup,
      isChild: depth > 0,
      depth: depth,
      hidden: layer.hidden,
      active: false,
      layer: layer,
    });

    if (layer.children) {
      result.push(...mapPsdLayers(layer.children, depth + 1));
    }
  }
  return result;
}
