/**
 * Nano Banana Pro — free-form image generation from a prompt and reference images.
 *
 * The user first picks the model and the API (Interactions / generateContent); the settings
 * below then show only what that combination supports (models.ts, options.ts) and the
 * request is written in that API's own format (request.ts).
 * Each run creates a new archive "<stamp>_Nano Banana Pro" with the image, Inputs/ and
 * Inputs/payload.json. Spec: docs/specs/tools/nano-banana-pro.md
 */
import { saveArchive } from '../../../shared/api/archives';
import {
  type GenerateContentPayload,
  type GenerationInput,
  type InteractionsPayload,
  generateImage,
  generateImageWithGenerateContent,
} from '../../../shared/api/generation';
import { ApiError } from '../../../shared/api/http';
import { emit } from '../../../shared/events';
import { toolSettings } from '../../../shared/state/tool-settings';
import type { Tool } from '../../../shared/types/tool';
import { openJsonPreview } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button, field, helpIcon, note, select } from '../../../shared/ui/form';
import { showToast } from '../../../shared/ui/toast';
import { fileStamp } from '../../../shared/utils/datetime';
import { imageExtension } from '../../../shared/utils/image';
import { MISSING_KEY_MESSAGE } from '../gemini-image/constants';
import { imageHeading, imageInput, inputFiles, startProgress } from '../gemini-image/payload';
import { promptField } from '../gemini-image/prompt-field';
import { createReferenceZones, type ReferenceImage } from '../gemini-image/reference-images';
import { DEFAULT_MODEL_ID, fitImagesToZones, findModel, IMAGE_MODELS, type ImageModel, outputSize } from './models';
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
import { generateContentRequest, interactionsRequest, redactImageData } from './request';
import './nano-banana-pro.css';

const DEFAULT_PROMPT =
  'この画像を元に、形状・構造・線画をできるだけ正確に維持したまま着彩して。線や輪郭、構図は一切変更せず、色のみを追加すること。';

const MODEL_NOTE = 'Gemini 3 の画像モデルは Thinking が常に有効。生成画像には SynthID 電子透かしが必ず付与される。';

type GenerationRequest =
  { api: 'interactions'; payload: InteractionsPayload } | { api: 'generateContent'; payload: GenerateContentPayload };

const apiLabel = (api: GeminiApi) => APIS.find(a => a.value === api)?.label ?? api;

export class NanoBananaProTool implements Tool {
  id = 'nano-banana-pro';
  name = 'Nano Banana Pro';
  icon = 'auto_awesome';

  private settings = toolSettings('nanoBananaPro');
  private images: ReferenceImage[] = [];
  private read: SettingsReader = (key, fallback) => this.settings.get(key, fallback);

  private get model(): ImageModel {
    return findModel(this.settings.get('model', DEFAULT_MODEL_ID));
  }

  private get api(): GeminiApi {
    return toApi(this.settings.get('api', DEFAULT_API));
  }

  renderSettings(container: HTMLElement): void {
    const modelInfo = note('');
    modelInfo.classList.add('nbp-model-info');
    const details = h('div', { class: 'nbp-details' });
    const renderDetails = () => {
      const model = this.model;
      const removed = fitImagesToZones(this.images, model.zones);
      if (removed) showToast(`このモデルの参照画像の上限を超えるため、${removed} 枚を外しました。`, 'info');
      modelInfo.replaceChildren(
        h('div', { class: 'nbp-model-info__name', text: `正式名: ${model.officialName}（${model.id}）` }),
        h('div', { text: model.description }),
      );
      details.replaceChildren(...this.detailElements(renderDetails));
    };

    container.append(
      h(
        'div',
        { class: 'nbp-step' },
        h('div', { class: 'nbp-step__title', text: '1. モデルと API' }),
        field(
          'モデル',
          select(
            IMAGE_MODELS.map(m => ({ value: m.id, label: m.nickname })),
            this.model.id,
            v => {
              this.settings.set('model', v);
              renderDetails();
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
              renderDetails();
            },
          ),
          'Interactions API: POST /v1beta/interactions（安全設定は指定できない）。\n' +
            'generateContent API: POST /v1beta/models/{model}:generateContent（安全設定・temperature 等を指定できる）。',
        ),
      ),
      details,
      button('JSONプレビュー', () => void this.preview(), { block: true }),
    );
    renderDetails();
  }

  /** Step 2: prompt, reference images and the settings the selected model / API supports. */
  private detailElements(rerender: () => void): HTMLElement[] {
    const model = this.model;
    const api = this.api;
    const elements: HTMLElement[] = [
      h(
        'div',
        { class: 'nbp-step nbp-step--second' },
        h('div', { class: 'nbp-step__title', text: '2. 生成設定' }),
        h('div', {
          class: 'nbp-step__subtitle',
          text: `${model.nickname}（${model.officialName}）× ${apiLabel(api)}`,
        }),
      ),
      promptField('プロンプト', this.settings, DEFAULT_PROMPT),
      ...createReferenceZones(this.images, [...model.zones]),
    ];
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
    for (const image of this.images) input.push(await imageInput(image.file));
    const defaultPrompt = this.settings.get('defaultPrompt', DEFAULT_PROMPT);
    text += `# User prompt\n${this.settings.get('prompt', defaultPrompt) || defaultPrompt}`;
    input.push({ type: 'text', text });

    const options = resolveOptions(this.read, model, api);
    return api === 'generateContent'
      ? { api, payload: generateContentRequest(model.id, input, options) }
      : { api, payload: interactionsRequest(model.id, input, options) };
  }

  private async preview(): Promise<void> {
    try {
      const { api, payload } = await this.buildRequest();
      const endpoint = api === 'generateContent' ? `models/${payload.model}:generateContent` : 'interactions';
      openJsonPreview(redactImageData(payload, 'BASE64_IMAGE_DATA'), `JSON Preview — ${apiLabel(api)} (${endpoint})`);
    } catch (err) {
      alert((err as Error).message || 'ペイロードの生成に失敗しました。');
    }
  }

  async execute(): Promise<void> {
    const request = await this.buildRequest();
    const stopProgress = startProgress(s => emit('tool:progress', { message: `Generating image... (${s}s elapsed)` }));
    try {
      let blob: Blob;
      try {
        blob =
          request.api === 'generateContent'
            ? await generateImageWithGenerateContent(request.payload)
            : await generateImage(request.payload);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        // The whole detail (message + raw_response) is shown so safety blocks stay visible in error.txt.
        const message = typeof err.detail === 'object' && err.detail ? JSON.stringify(err.detail) : err.message;
        throw new Error(message.includes('GEMINI_API_KEY is not set') ? MISSING_KEY_MESSAGE : message);
      }

      // The backend answers with the image's real MIME type, which decides the extension.
      const mimeType = blob.type.startsWith('image/') ? blob.type : 'image/png';
      const archive = `${fileStamp()}_${this.name}`;
      const savedPayload = redactImageData(request.payload, '[Image data omitted — see Image files in this folder]');
      await saveArchive(archive, [
        { blob, path: `${archive}${imageExtension(mimeType)}` },
        ...inputFiles(this.images, (_image, i) => `Image${i + 1}`),
        {
          blob: new Blob([JSON.stringify(savedPayload, null, 2)], { type: 'application/json' }),
          path: 'Inputs/payload.json',
        },
      ]);
      emit('archives:changed');
    } finally {
      stopProgress();
    }
  }
}

const aspectSetting = () => SETTINGS.find(s => s.key === 'aspectRatio') as ChoiceSetting;
const sizeSetting = () => SETTINGS.find(s => s.key === 'imageSize') as ChoiceSetting;

/** Aspect ratio buttons with a "既定" button spanning the first row. */
function aspectRatioGrid(ratios: string[], value: string, onChange: (value: string) => void): HTMLElement {
  let selected = value;
  const buttons = [UNSET, ...ratios].map(ar => {
    if (ar === UNSET) {
      return h('button', { class: 'ar-grid__btn ar-grid__btn--unset', text: UNSET_LABEL, onclick: () => pick(ar) });
    }
    const [w, h_] = ar.split(':').map(Number);
    const box =
      w > h_ ? { width: '16px', height: `${(h_ / w) * 16}px` } : { width: `${(w / h_) * 16}px`, height: '16px' };
    return h(
      'button',
      { class: 'ar-grid__btn', onclick: () => pick(ar) },
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
