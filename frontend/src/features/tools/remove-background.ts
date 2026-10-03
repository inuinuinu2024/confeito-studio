/**
 * 背景除去 — removes the background of the selected image locally with rembg
 * (backend: services/image_service.py) and saves nobg.png + info.json as a tool result
 * ("<selected archive>/<YYYYMMDD_HHMMSS>_背景除去/", see result.ts).
 */
import { removeBackground } from '../../shared/api/image';
import { emit } from '../../shared/events';
import { toolSettings } from '../../shared/state/tool-settings';
import { type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { button, field, slider, switchRow } from '../../shared/ui/form';
import { AppMessageError } from '../../shared/utils/error-message';
import { canvasToBlob } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';
import { saveToolResult } from './result';
import { imageTargetCard } from './target-card';

const DEFAULTS = { alpha_matting: 'true', fg_threshold: '240', bg_threshold: '10', erode_size: '10' };

const SLIDERS = [
  {
    key: 'fg_threshold',
    label: '前景しきい値',
    max: 255,
    help: '前景（残す部分）として判定されるしきい値です。値を下げるとより広い範囲が前景として残ります。',
  },
  {
    key: 'bg_threshold',
    label: '背景しきい値',
    max: 255,
    help: '背景（削除する部分）として判定されるしきい値です。値を上げるとより広い範囲が背景として削除されます。',
  },
  {
    key: 'erode_size',
    label: '浸食サイズ',
    max: 50,
    help: '前景の境界をどれだけ削るか（浸食させるか）を指定します。背景のフチが残ってしまう場合は値を上げてください。',
  },
] as const;

export class RemoveBackgroundTool implements Tool {
  id = 'remove-background';
  name = '背景除去';
  icon = '';
  executeIcon = null;

  settingsPrefix = 'removeBg';
  private settings = toolSettings(this.settingsPrefix);

  private get(key: keyof typeof DEFAULTS): string {
    return this.settings.get(key, DEFAULTS[key]);
  }

  renderSettings(container: HTMLElement): void {
    const alphaMatting = switchRow(
      'アルファマッチングを使用',
      this.get('alpha_matting') === 'true',
      on => this.settings.set('alpha_matting', String(on)),
      'アルファマッチング（境界の透過処理）を有効にします。髪の毛など、境界が複雑な画像の切り抜き精度が向上します。無効にすると輪郭がくっきりと切り抜かれます。',
    );
    const sliders = SLIDERS.map(s => ({
      key: s.key,
      control: slider({ min: 0, max: s.max, value: this.get(s.key), onInput: v => this.settings.set(s.key, v) }),
      def: s,
    }));

    const reset = () => {
      alphaMatting.setValue(true);
      this.settings.set('alpha_matting', DEFAULTS.alpha_matting);
      for (const s of sliders) {
        s.control.setValue(DEFAULTS[s.key]);
        this.settings.set(s.key, DEFAULTS[s.key]);
      }
    };

    container.append(
      imageTargetCard(this.name, '背景を除去する画像'),
      alphaMatting.el,
      ...sliders.map(s => field(s.def.label, s.control.el, s.def.help)),
      button('初期値へ戻す', reset, { variant: 'outline', block: true }),
    );
  }

  async execute(context: ToolContext): Promise<string> {
    const canvas = await context.getSelectedImage();
    if (!canvas) throw new ToolNotReady('ARCHIVES で対象の画像を選択してください。');
    const input = await canvasToBlob(canvas, 'image/png');
    if (!input) throw new AppMessageError('画像を PNG に変換できませんでした。');

    const result = await removeBackground(input, {
      alphaMatting: this.get('alpha_matting'),
      foregroundThreshold: this.get('fg_threshold'),
      backgroundThreshold: this.get('bg_threshold'),
      erodeSize: this.get('erode_size'),
    });

    const folder = await saveToolResult(this.name, [{ blob: result, path: 'nobg.png' }], {
      source: DocumentManager.getInstance().getCurrentKey(),
      settings: {
        alpha_matting: this.get('alpha_matting') === 'true',
        fg_threshold: Number(this.get('fg_threshold')),
        bg_threshold: Number(this.get('bg_threshold')),
        erode_size: Number(this.get('erode_size')),
      },
    });
    emit('archives:changed', { autoSelectKey: `${folder}/nobg.png` });
    return `「${folder}」に保存しました`;
  }
}
