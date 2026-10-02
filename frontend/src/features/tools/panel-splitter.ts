/**
 * コマ分割 — detects manga panels with Gemini and saves each as 01.png, 02.png, ... plus
 * panels.json (backend: services/panel_service.py). Spec: docs/specs/tools/panel-split-merge.md
 */
import { ApiError } from '../../shared/api/http';
import { type PanelSplitOptions, previewSplitPanels, splitPanels } from '../../shared/api/image';
import { emit } from '../../shared/events';
import { toolSettings } from '../../shared/state/tool-settings';
import type { Tool, ToolContext } from '../../shared/types/tool';
import { openJsonPreview } from '../../shared/ui/dialogs';
import { h, icon } from '../../shared/ui/dom';
import { button, field, select, slider } from '../../shared/ui/form';
import { showToast } from '../../shared/ui/toast';
import { canvasToBlob } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';

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
  executeLabel = 'コマ分割を実行';
  executeIcon = 'auto_awesome';

  private settings = toolSettings('panelSplitter');

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
      this.targetCard(),
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

  /** Shows the selected image and where the panels will be saved. */
  private targetCard(): HTMLElement {
    const docManager = DocumentManager.getInstance();
    const canvas = docManager.getCurrentCanvas();
    if (!canvas) {
      return h(
        'div',
        { class: 'cs-card' },
        h('div', { class: 'cs-card__warning', text: '⚠️ 分割対象の画像が選択されていません' }),
        h('div', { class: 'cs-card__line', text: '左側のARCHIVESから分割したい画像を選択してください。' }),
      );
    }
    const folder = docManager.getCurrentArchiveFolder();
    return h(
      'div',
      { class: 'cs-card' },
      h('div', { class: 'cs-card__title', text: `対象画像: ${docManager.getCurrentFilename() || 'キャンバス画像'}` }),
      h(
        'div',
        { class: 'cs-card__line cs-card__line--accent' },
        icon('folder', 13),
        `保存先: ${folder ? `${folder} / [日時]_コマ分割/ (サブフォルダ)` : '[日時]_コマ分割/ (新規フォルダ作成)'}`,
      ),
      h('div', { class: 'cs-card__line', text: `解像度: ${canvas.width} × ${canvas.height} px` }),
    );
  }

  private async preview(): Promise<void> {
    const opts = this.options();
    const docManager = DocumentManager.getInstance();
    const canvas = docManager.getCurrentCanvas();
    const folder = docManager.getCurrentArchiveFolder();
    const prefix = folder ? 'YYYYMMDD_HHMMSS_コマ分割/' : '';
    let request;
    try {
      request = await previewSplitPanels(opts);
    } catch (err) {
      alert((err as Error).message || 'ペイロードの生成に失敗しました。');
      return;
    }
    openJsonPreview({
      ...request,
      output_format: {
        save_destination: folder
          ? `${folder}/YYYYMMDD_HHMMSS_コマ分割/ (選択中フォルダ内のサブフォルダ)`
          : 'YYYYMMDD_HHMMSS_コマ分割/ (新規フォルダ作成)',
        archive_path: folder ? `${folder}/YYYYMMDD_HHMMSS_コマ分割` : 'YYYYMMDD_HHMMSS_コマ分割',
        generated_files: [
          `${prefix}01.png, 02.png, ... (${folder ? '切り分けられた各コマの' : ''}個別PNG画像)`,
          `${prefix}panels.json (構造化JSONデータ)`,
          folder ? 'log.txt (元フォルダのlog.txtに一文追記)' : 'log.txt (実行ログ一文)',
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

  async execute(context: ToolContext): Promise<void> {
    const docManager = DocumentManager.getInstance();
    const canvas = await context.getSelectedImage();
    if (!canvas) throw new Error('ARCHIVESで分割対象の画像を選択してください。');
    const image = await canvasToBlob(canvas, 'image/png');
    if (!image) throw new Error('画像のBlobデータ変換に失敗しました。');

    let result;
    try {
      result = await splitPanels(
        image,
        docManager.getCurrentFilename() || 'image.png',
        docManager.getCurrentArchiveFolder(),
        this.options(),
      );
    } catch (err) {
      if (err instanceof ApiError) throw new Error(`コマ分割処理に失敗しました: ${err.message}`);
      throw err;
    }

    const folder = result.sub_folder ? `${result.archive_name}/${result.sub_folder}` : result.archive_name;
    docManager.setCurrentArchiveFolder(folder);
    emit('archives:changed', { autoSelectKey: result.auto_select_key || `${result.folder_name}/01.png` });
    showToast(`「${folder}」に ${result.panels_count} コマを分割保存しました（panels.json 出力完了）`, 'success');
  }
}
