/**
 * コマ分割 — detects manga panels with Gemini and saves each as 01.png, 02.png, ... plus
 * panels.json and info.json in "<selected archive>/<stamp>_コマ分割/" (backend: services/panel_service.py).
 * Spec: docs/specs/tools/panel-split-merge.md
 */
import { type PanelSplitOptions, previewSplitPanels, splitPanels } from '../../shared/api/image';
import { emit } from '../../shared/events';
import { toolSettings } from '../../shared/state/tool-settings';
import { type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { openJsonPreview } from '../../shared/ui/dialogs';
import { button, field, select, slider } from '../../shared/ui/form';
import { showError } from '../../shared/ui/toast';
import { AppMessageError } from '../../shared/utils/error-message';
import { canvasToBlob } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';
import { selectedArchive } from './result';
import { imageTargetCard } from './target-card';

const MODELS = [
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
];
const THINKING_LEVELS = ['LOW', 'MEDIUM', 'HIGH'].map(v => ({ value: v, label: v }));
const READING_ORDERS = [
  { value: 'left_to_right', label: '左上から右下（ウェブトゥーン・左開き）' },
  { value: 'right_to_left', label: '右上から左下（日本の漫画・右開き標準）' },
];

export class PanelSplitterTool implements Tool {
  id = 'panel-splitter';
  name = 'コマ分割';
  icon = 'auto_awesome';
  executeIcon = 'auto_awesome';

  settingsPrefix = 'panelSplitter';
  private settings = toolSettings(this.settingsPrefix);

  private options(): PanelSplitOptions {
    let model = this.settings.get('model', 'gemini-3.8-flash');
    if (model === 'gemini-3.1-pro') {
      model = 'gemini-3.1-pro-preview'; // migrate the pre-preview model id
      this.settings.set('model', model);
    }
    return {
      model,
      thinkingLevel: this.settings.get('thinking_level', 'LOW'),
      readingOrder: this.settings.get('reading_order', 'left_to_right'),
      padding: parseInt(this.settings.get('padding', '0'), 10) || 0,
    };
  }

  renderSettings(container: HTMLElement): void {
    const opts = this.options();
    const set = (key: string) => (value: string) => this.settings.set(key, value);
    container.append(
      imageTargetCard(this.name, '分割する画像'),
      field(
        'モデル (Model)',
        select(MODELS, opts.model, set('model')),
        'コマ枠認識に使用するGeminiモデルを選択します。',
      ),
      field(
        '推論レベル (thinkingLevel)',
        select(THINKING_LEVELS, opts.thinkingLevel, set('thinking_level')),
        'Gemini 3系モデルの思考深度（thinkingConfig）を設定します。',
      ),
      field(
        'コマの読み順（連番の並び順）',
        select(READING_ORDERS, opts.readingOrder, set('reading_order')),
        '連番ファイル名（01.png, 02.png...）を付与する際のコマの順序を指定します。',
      ),
      field(
        'コマ余白（パディング）',
        slider({ min: 0, max: 30, value: String(opts.padding), format: v => `${v}px`, onInput: set('padding') }).el,
        '検出されたコマ枠線の外側に余白（ピクセル）を追加して切り抜きます。',
      ),
      button('JSONプレビュー', () => void this.preview(), { block: true }),
    );
  }

  private async preview(): Promise<void> {
    const opts = this.options();
    const docManager = DocumentManager.getInstance();
    const canvas = docManager.getCurrentCanvas();
    const archive = selectedArchive();
    const folder = archive ? `${archive}/YYYYMMDD_HHMMSS_コマ分割` : 'YYYYMMDD_HHMMSS_コマ分割';
    let request;
    try {
      request = await previewSplitPanels(opts);
    } catch (err) {
      showError('JSON プレビューを作成できませんでした', err);
      return;
    }
    openJsonPreview({
      ...request,
      output_format: {
        save_destination: archive
          ? `${folder}/ (選択中アーカイブの中。同名があれば _2, _3 … を付ける)`
          : `${folder}/ (新しいアーカイブ。同名があれば _2, _3 … を付ける)`,
        generated_files: [
          `${folder}/01.png, 02.png, ... (切り分けた各コマの PNG)`,
          `${folder}/panels.json (コマの座標データ。コマ結合で使う)`,
          `${folder}/info.json (ツール名・日時・元画像・設定)`,
        ],
        panels_json_sample: {
          version: '1.0',
          created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
          original_filename: docManager.getCurrentFilename() || 'image.png',
          image_size: { width: canvas ? canvas.width : 1200, height: canvas ? canvas.height : 1800 },
          reading_order: opts.readingOrder,
          model: opts.model,
          thinking_level: opts.thinkingLevel,
          padding: opts.padding,
          panels_count: 4,
          panels: [
            {
              panel_number: 1,
              filename: '01.png',
              pixel_box: [0, 0, 500, 600],
              xywh: [0, 0, 500, 600],
              box_2d: [0, 0, 500, 500],
              width: 500,
              height: 600,
            },
          ],
        },
      },
    });
  }

  async execute(context: ToolContext): Promise<string> {
    const docManager = DocumentManager.getInstance();
    const canvas = await context.getSelectedImage();
    if (!canvas) throw new ToolNotReady('ARCHIVES で対象の画像を選択してください。');
    const image = await canvasToBlob(canvas, 'image/png');
    if (!image) throw new AppMessageError('画像を PNG に変換できませんでした。');

    const result = await splitPanels(
      image,
      docManager.getCurrentFilename() || 'image.png',
      selectedArchive(),
      docManager.getCurrentKey(),
      this.options(),
    );

    emit('archives:changed', { autoSelectKey: result.auto_select_key });
    return `${result.panels_count} コマに分割し、「${result.folder}」に保存しました`;
  }
}
