/**
 * Canvas background colour (chosen in the settings dialog, docs/specs/canvas.md).
 * Kept in the user's settings as "canvas_bgColor" and written as soon as it is chosen.
 */
import { emit } from '../events';
import { toolSettings } from './tool-settings';

/** `checkerboard` is a special value understood by the canvas renderer. */
export const BG_COLORS = [
  { label: 'White', name: '白', value: '#FFFFFF' },
  { label: 'Light Gray', name: 'ライトグレー', value: '#B3B3B3' },
  { label: 'Dark Gray', name: 'ダークグレー', value: '#666666' },
  { label: 'Black', name: '黒', value: '#000000' },
  { label: 'Checkerboard', name: '市松模様', value: 'checkerboard' },
  { label: 'Blue', name: '青', value: '#0000FF' },
  { label: 'Green', name: '緑', value: '#00FF00' },
  { label: 'Red', name: '赤', value: '#FF0000' },
] as const;

export const DEFAULT_BG_COLOR = 'checkerboard';

const settings = toolSettings('canvas');
const KEY = 'bgColor';

/** `value` when it is one of `BG_COLORS`, otherwise the default colour. */
export function normalizeBgColor(value: string): string {
  return BG_COLORS.some(color => color.value === value) ? value : DEFAULT_BG_COLOR;
}

/** Saved background colour (the default when absent or unknown). */
export function loadBgColor(): string {
  return normalizeBgColor(settings.get(KEY, DEFAULT_BG_COLOR));
}

/** Applies the colour to the canvas and writes it to the settings file right away. */
export function saveBgColor(value: string): void {
  settings.set(KEY, value);
  void settings.save([KEY]);
  emit('canvas:bg-color', { color: value });
}
