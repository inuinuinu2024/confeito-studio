/**
 * Nano Banana画像生成 — free-form image generation from a prompt and reference images.
 * (Ids, the settings prefix "nanoBananaPro" and the backend routes keep the former name "Nano Banana Pro".)
 *
 * The user first picks the model and the API (Interactions / generateContent); the settings
 * below then show only what that combination supports (models.ts, options.ts) and the
 * request is written in that API's own format (request.ts).
 * With a 原画 (original image) the aspect ratio follows the original, and the output is cut back to
 * the original's size (original.ts, original-image.ts).
 * Each run saves the image, Inputs/ (reference images, payload.json) and info.json as a tool
 * result ("<selected archive>/<stamp>_Nano Banana画像生成/", see ../result.ts).
 * Spec: docs/specs/tools/nano-banana-pro.md
 */
import {
  type GenerateContentPayload,
  type GenerationInput,
  type InteractionsPayload,
  generateImage,
  generateImageWithGenerateContent,
} from '../../../shared/api/generation';
import { emit } from '../../../shared/events';
import { toolSettings } from '../../../shared/state/tool-settings';
import { isViewMode } from '../../../shared/state/view-mode';
import { type Tool, type ToolContext, ToolNotReady } from '../../../shared/types/tool';
import { openJsonPreview } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button, field, helpIcon, note, select } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';
import { fileStamp } from '../../../shared/utils/datetime';
import { imageExtension } from '../../../shared/utils/image';
import { imageHeading, imageInput, inputFiles, startProgress, uploadImage } from '../gemini-image/payload';
import { promptField } from '../gemini-image/prompt-field';
import { createReferenceList, type ReferenceImage } from '../gemini-image/reference-images';
import { fitImagesToModel, totalLimit } from '../gemini-image/reference-list';
import { DocumentManager } from '../../document/DocumentManager';
import { discardIfStopped, saveToolResult } from '../result';
import { DEFAULT_MODEL_ID, findModel, IMAGE_MODELS, type ImageModel, outputSize } from './models';
import {
  APIS,
  type ChoiceSetting,
  DEFAULT_API,
  effectiveValue,
  type GeminiApi,
  HARM_CATEGORIES,
  isAvailable,
  type NumberSetting,
  resolveOptions,
  SECTIONS,
  type Setting,
  SETTINGS,
  type SettingsReader,
  safetyKey,
  type TextSetting,
  toApi,
  UNSET,
  UNSET_LABEL,
} from './options';
import {
  autoAspectRatio,
  expectedOutputSize,
  type OriginalLayout,
  originalHeading,
  originalLayout,
  type Padding,
} from './original';
import {
  buildSentImage,
  createOriginalSection,
  type OriginalImage,
  originalFromCanvas,
  restoreImage,
} from './original-image';
import { generateContentRequest, interactionsRequest, redactImageData } from './request';
import './nano-banana-pro.css';

const MODEL_NOTE = 'Gemini 3 の画像モデルは Thinking が常に有効。生成画像には SynthID 電子透かしが必ず付与される。';

/** How the 原画 is sent: the automatic aspect ratio, the expected output size and the padded layout. */
interface OriginalPlan {
  image: OriginalImage;
  aspectRatio: string;
  target: [number, number];
  layout: OriginalLayout;
}

type GenerationRequest = (
  { api: 'interactions'; payload: InteractionsPayload } | { api: 'generateContent'; payload: GenerateContentPayload }
) & { original: OriginalPlan | null };

const PADDING_TEXT: Record<Padding, string> = {
  none: '余白なし',
  vertical: '上下に白い余白',
  horizontal: '左右に白い余白',
};

const apiLabel = (api: GeminiApi) => APIS.find(a => a.value === api)?.label ?? api;

export class NanoBananaProTool implements Tool {
  id = 'nano-banana-pro';
  name = 'Nano Banana画像生成';
  icon = 'auto_awesome';
  windowColumns = 3;

  settingsPrefix = 'nanoBananaPro';
  private settings = toolSettings(this.settingsPrefix);
  private images: ReferenceImage[] = [];
  private original: OriginalImage | null = null;
  /** With a 原画 the aspect ratio is the automatic one; the stored value is kept for when it is removed. */
  private read: SettingsReader = (key, fallback) =>
    key === 'aspectRatio' && this.original
      ? autoAspectRatio(this.original.width, this.original.height, this.model)
      : this.settings.get(key, fallback);

  private get model(): ImageModel {
    return findModel(this.settings.get('model', DEFAULT_MODEL_ID));
  }

  private get api(): GeminiApi {
    return toApi(this.settings.get('api', DEFAULT_API));
  }

  /** Reference images allowed: the model's total, less one for the 原画 (sent as one more image). */
  private referenceLimit(model: ImageModel): number {
    return totalLimit(model.zones) - (this.original ? 1 : 0);
  }

  /** How the 原画 is sent with the model / API / image size, or null without a 原画. */
  private originalPlan(model: ImageModel, api: GeminiApi): OriginalPlan | null {
    const image = this.original;
    if (!image) return null;
    const aspectRatio = autoAspectRatio(image.width, image.height, model);
    const target = expectedOutputSize(model, aspectRatio, effectiveValue(sizeSetting(), this.read, model, api));
    if (!target) return null;
    return { image, aspectRatio, target, layout: originalLayout(image.width, image.height, target) };
  }

  /**
   * Opens with the image on the canvas as the 原画 (docs/specs/tools/nano-banana-pro.md 「原画」): only in the
   * normal view mode, and not when the reference images already fill the limit (adding it would drop one).
   * Without an image the previous 原画 stays.
   */
  async beforeOpen(): Promise<void> {
    if (!isViewMode('normal')) return;
    const docManager = DocumentManager.getInstance();
    if (!docManager.getCurrentCanvas()) return;
    if (!this.original && this.images.length > totalLimit(this.model.zones) - 1) return;
    const key = docManager.getCurrentKey();
    if (key && this.original?.key === key) return; // already this image
    this.original = (await originalFromCanvas()) ?? this.original;
  }

  /**
   * Three columns: model / API and the prompt | 原画 and reference images | the other parameters.
   * Changing the model, the API or the 原画 rebuilds the middle and right columns.
   */
  renderSettings(container: HTMLElement): void {
    const modelInfo = note('');
    modelInfo.classList.add('nbp-model-info');
    const references = h('div', { class: 'tool-window__column' });
    const parameters = h('div', { class: 'tool-window__column nbp-parameters' });
    const previewButton = button('JSONプレビュー', () => void this.preview(), { block: true });
    const renderModelDependent = () => {
      const model = this.model;
      const limit = this.referenceLimit(model);
      const { retyped, removed } = fitImagesToModel(this.images, model.zones, limit);
      if (retyped) showToast(`このモデルにない種類の参照画像 ${retyped} 枚を「${model.zones[0].title}」にしました。`);
      if (removed) {
        const what = this.original
          ? `原画を除いた参照画像の上限（${limit} 枚）`
          : `このモデルの参照画像の上限（${limit} 枚）`;
        showToast(`${what}を超えるため、${removed} 枚を外しました。`, 'warning');
      }
      modelInfo.replaceChildren(
        h('div', { class: 'nbp-model-info__name', text: `正式名: ${model.officialName}（${model.id}）` }),
        h('div', { text: model.description }),
      );
      references.replaceChildren(
        this.originalSection(renderModelDependent),
        createReferenceList(this.images, [...model.zones], limit),
      );
      parameters.replaceChildren(...this.parameterElements(renderModelDependent), previewButton);
    };

    const prompt = promptField('プロンプト', this.settings, this.settingsPrefix);
    prompt.classList.add('nbp-prompt');
    container.append(
      h(
        'div',
        { class: 'tool-window__column' },
        h(
          'div',
          { class: 'nbp-step' },
          h('div', { class: 'nbp-step__title', text: 'モデルと API' }),
          field(
            'モデル',
            select(
              IMAGE_MODELS.map(m => ({ value: m.id, label: m.nickname })),
              this.model.id,
              v => {
                this.settings.set('model', v);
                renderModelDependent();
              },
            ),
          ),
          modelInfo,
          field(
            'API',
            select(
              APIS.map(a => ({ value: a.value, label: a.label })),
              this.api,
              v => {
                this.settings.set('api', v);
                renderModelDependent();
              },
            ),
            'Interactions API: POST /v1beta/interactions（安全設定は指定できない）。\n' +
              'generateContent API: POST /v1beta/models/{model}:generateContent（安全設定・temperature 等を指定できる）。',
          ),
        ),
        prompt,
      ),
      references,
      parameters,
    );
    renderModelDependent();
  }

  /** The 原画 section; setting or removing the 原画 rebuilds the middle and right columns. */
  private originalSection(rerender: () => void): HTMLElement {
    const plan = this.originalPlan(this.model, this.api);
    const details = plan
      ? [`アスペクト比 ${plan.aspectRatio} に合わせて${PADDING_TEXT[plan.layout.padding]}を足して送る`]
      : [];
    return createOriginalSection(this.original, details, original => {
      this.original = original;
      rerender();
    });
  }

  /** Right column: the settings the selected model / API supports, by section. */
  private parameterElements(rerender: () => void): HTMLElement[] {
    const model = this.model;
    const api = this.api;
    const elements: HTMLElement[] = [];
    const refreshOutputLabels: (() => void)[] = [];

    for (const section of SECTIONS) {
      const settings = SETTINGS.filter(s => s.section === section.id && isAvailable(s, model, api));
      if (settings.length === 0) continue;
      const title = h('div', { class: 'nbp-section__title' }, h('span', { text: section.title }));
      if (section.id === 'safety') title.append(this.safetyButtons(rerender));
      elements.push(title);
      for (const setting of settings) elements.push(this.settingField(setting, model, api, refreshOutputLabels));
    }
    if (model.thinks) elements.push(note(MODEL_NOTE));
    return elements;
  }

  private settingField(
    setting: Setting,
    model: ImageModel,
    api: GeminiApi,
    refreshOutputLabels: (() => void)[],
  ): HTMLElement {
    const help = `${setting.help}\n送信先: ${setting.paths[api]}`;
    const value = effectiveValue(setting, this.read, model, api);
    switch (setting.kind) {
      case 'choice':
        return field(setting.label, this.choiceControl(setting, model, api, value, refreshOutputLabels), help);
      case 'number':
        return field(setting.label, this.numberInput(setting, value), help);
      case 'text':
        return field(setting.label, this.textInput(setting, value), help);
    }
  }

  private choiceControl(
    setting: ChoiceSetting,
    model: ImageModel,
    api: GeminiApi,
    value: string,
    refreshOutputLabels: (() => void)[],
  ): HTMLElement {
    const options = setting.options(model, api);
    if (setting.widget === 'aspect-ratio') {
      const caption = h('div', { class: 'nbp-caption' });
      const renderCaption = (ar: string) => {
        const plan = this.originalPlan(model, api);
        if (plan) {
          const { image, target } = plan;
          caption.textContent =
            `原画に合わせて自動: ${plan.aspectRatio} / 生成: ${target[0]} x ${target[1]} px` +
            ` → 保存: ${image.width} x ${image.height} px（原画と同じ）`;
          return;
        }
        const size = outputSize(model, ar, effectiveValue(sizeSetting(), this.read, model, api));
        caption.textContent = ar !== UNSET && size ? `出力: ${size[0]} x ${size[1]} px` : '';
      };
      renderCaption(value);
      refreshOutputLabels.push(() => renderCaption(this.aspectRatio(model, api)));
      const grid = aspectRatioGrid(
        options.map(o => o.value),
        value,
        ar => {
          this.settings.set(setting.key, ar);
          refreshOutputLabels.forEach(fn => fn());
        },
        !!this.original,
      );
      return h('div', { class: 'nbp-aspect' }, grid, caption);
    }

    const el = select([], value, v => {
      this.settings.set(setting.key, v);
      if (setting.widget === 'image-size') refreshOutputLabels.forEach(fn => fn());
    });
    const renderOptions = () => {
      const current = el.value || value;
      const ar = this.aspectRatio(model, api);
      el.replaceChildren(
        h('option', { value: UNSET, text: UNSET_LABEL }),
        ...options.map(o => {
          const size = setting.widget === 'image-size' && ar !== UNSET ? outputSize(model, ar, o.value) : null;
          return h('option', { value: o.value, text: size ? `${o.label} (${size[0]} x ${size[1]} px)` : o.label });
        }),
      );
      el.value = current;
    };
    renderOptions();
    if (setting.widget === 'image-size') refreshOutputLabels.push(renderOptions);
    return el;
  }

  private aspectRatio(model: ImageModel, api: GeminiApi): string {
    return effectiveValue(aspectSetting(), this.read, model, api);
  }

  private numberInput(setting: NumberSetting, value: string): HTMLInputElement {
    const input = h('input', {
      type: 'number',
      class: 'cs-input',
      min: String(setting.min),
      max: String(setting.max),
      step: setting.integer ? '1' : 'any',
      placeholder: `${UNSET_LABEL}  ${setting.min}〜${setting.max}`,
      value,
    });
    input.addEventListener('input', () => this.settings.set(setting.key, input.value));
    return input;
  }

  private textInput(setting: TextSetting, value: string): HTMLTextAreaElement {
    const textarea = h('textarea', { class: 'cs-textarea nbp-textarea', placeholder: UNSET_LABEL, value });
    textarea.addEventListener('input', () => this.settings.set(setting.key, textarea.value));
    return textarea;
  }

  private safetyButtons(rerender: () => void): HTMLElement {
    const setAll = (threshold: string) => {
      for (const { category } of HARM_CATEGORIES) this.settings.set(safetyKey(category), threshold);
      rerender();
    };
    return h(
      'div',
      { class: 'nbp-section__actions' },
      helpIcon('generateContent API の safetySettings。カテゴリごとにブロックのしきい値を指定する。'),
      button('すべて OFF', () => setAll('OFF'), { size: 'small' }),
      button('すべて既定', () => setAll(UNSET), { size: 'small' }),
    );
  }

  private async buildRequest(): Promise<GenerationRequest> {
    const model = this.model;
    const api = this.api;
    let text = '';
    this.images.forEach((image, i) => (text += imageHeading(i + 1, image)));
    const input: GenerationInput[] = [];
    // Large reference images are scaled down for sending; Inputs/ keeps the files as added.
    for (const image of this.images) input.push(await imageInput(await uploadImage(image.file)));
    // The 原画 goes after the reference images, so their "# Image N" numbers stay as on the cards.
    const original = this.originalPlan(model, api);
    if (original) {
      input.push(await imageInput(await buildSentImage(original.image, original.layout)));
      text += originalHeading(this.images.length + 1, original.layout.padding);
    }
    text += `# User prompt\n${this.settings.get('prompt', '')}`;
    input.push({ type: 'text', text });

    const options = resolveOptions(this.read, model, api);
    return api === 'generateContent'
      ? { api, payload: generateContentRequest(model.id, input, options), original }
      : { api, payload: interactionsRequest(model.id, input, options), original };
  }

  private async preview(): Promise<void> {
    try {
      const { api, payload } = await this.buildRequest();
      const endpoint = api === 'generateContent' ? `models/${payload.model}:generateContent` : 'interactions';
      openJsonPreview(redactImageData(payload, 'BASE64_IMAGE_DATA'), `JSON Preview — ${apiLabel(api)} (${endpoint})`);
    } catch (err) {
      showError('JSON プレビューを作成できませんでした', err);
    }
  }

  async execute(context: ToolContext): Promise<string> {
    if (!this.settings.get('prompt', '').trim()) throw new ToolNotReady('プロンプトを入力してください');
    context.ready();
    const request = await this.buildRequest();
    const stopProgress = startProgress(s => emit('tool:progress', { message: `Generating image... (${s}s elapsed)` }));
    try {
      // On failure the ApiError carries the upstream response (safety blocks etc.); the error toast shows it.
      const blob =
        request.api === 'generateContent'
          ? await generateImageWithGenerateContent(request.payload, context.signal)
          : await generateImage(request.payload, context.signal);

      // The backend answers with the image's real MIME type, which decides the extension.
      const mimeType = blob.type.startsWith('image/') ? blob.type : 'image/png';
      const extension = imageExtension(mimeType);
      const stamp = fileStamp();
      const imagePath = `${stamp}_${this.name}${extension}`;
      const savedPayload = redactImageData(request.payload, '[Image data omitted — see Image files in this folder]');
      const files = [
        ...inputFiles(this.images, (_image, i) => `Image${i + 1}`),
        {
          blob: new Blob([JSON.stringify(savedPayload, null, 2)], { type: 'application/json' }),
          path: 'Inputs/payload.json',
        },
      ];
      const settings: Record<string, unknown> = { model: this.model.id, api: request.api };
      let source: string | null = null;
      if (request.original) {
        // The result is the generated image cut back to the original's size; the image as generated goes to Raw/.
        const { image, layout, aspectRatio } = request.original;
        const restored = await restoreImage(blob, layout.rect, image.width, image.height);
        files.unshift({ blob: restored.blob, path: imagePath }, { blob, path: `Raw/generated${extension}` });
        // A 原画 taken from ARCHIVES is recorded as the source; one added from a file is kept in Inputs/.
        if (image.key) source = image.key;
        else files.push({ blob: image.file, path: `Inputs/Original${imageExtension(image.file.type || 'image/png')}` });
        settings.original = {
          width: image.width,
          height: image.height,
          aspectRatio,
          padding: layout.padding,
          sentSize: layout.sent,
          generatedSize: restored.generatedSize,
        };
      } else {
        files.unshift({ blob, path: imagePath });
      }
      const folder = await saveToolResult(this.name, files, { source, settings }, stamp);
      await discardIfStopped(context.signal, folder);
      emit('archives:changed', { autoSelectKey: `${folder}/${imagePath}` });
      return `「${folder}」に画像を保存しました`;
    } finally {
      stopProgress();
    }
  }
}

const aspectSetting = () => SETTINGS.find(s => s.key === 'aspectRatio') as ChoiceSetting;
const sizeSetting = () => SETTINGS.find(s => s.key === 'imageSize') as ChoiceSetting;

/** Aspect ratio buttons with a "既定" button spanning the first row; `disabled` while a 原画 decides the ratio. */
function aspectRatioGrid(
  ratios: string[],
  value: string,
  onChange: (value: string) => void,
  disabled = false,
): HTMLElement {
  let selected = value;
  const buttons = [UNSET, ...ratios].map(ar => {
    if (ar === UNSET) {
      return h('button', {
        class: 'ar-grid__btn ar-grid__btn--unset',
        text: UNSET_LABEL,
        disabled,
        onclick: () => pick(ar),
      });
    }
    const [w, h_] = ar.split(':').map(Number);
    const box =
      w > h_ ? { width: '16px', height: `${(h_ / w) * 16}px` } : { width: `${(w / h_) * 16}px`, height: '16px' };
    return h(
      'button',
      { class: 'ar-grid__btn', disabled, onclick: () => pick(ar) },
      h('div', { class: 'ar-grid__icon', style: box }),
      h('span', { text: ar }),
    );
  });
  const render = () =>
    buttons.forEach((b, i) => b.classList.toggle('ar-grid__btn--selected', [UNSET, ...ratios][i] === selected));
  const pick = (ar: string) => {
    selected = ar;
    render();
    onChange(ar);
  };
  render();
  return h('div', { class: `ar-grid${ratios.length > 10 ? ' ar-grid--wide' : ''}` }, ...buttons);
}
