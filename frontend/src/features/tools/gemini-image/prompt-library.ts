/**
 * Registered prompts (docs/specs/tools/gemini-image.md 「プロンプト」): the register dialog and the
 * list dialog (use / edit / delete). Every change is saved to the backend at once, apart from the
 * tool settings; using a prompt only replaces the prompt field (saved with the settings when the tool runs).
 */
import { createPrompt, deletePrompt, listPrompts, type SavedPrompt, updatePrompt } from '../../../shared/api/prompts';
import { confirmDialog, createModal, escapeClosable } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button, field } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';
import { findByName, MAX_NAME_LENGTH, previewText, promptInputError } from './prompt-list';
import './prompt-library.css';

const OVERLAY_CLASS = 'prompt-dialog-overlay';

/** The tool's prompts (warnings as toasts), or null after an error toast. */
async function fetchPrompts(tool: string): Promise<SavedPrompt[] | null> {
  try {
    const { prompts, warnings } = await listPrompts(tool);
    for (const warning of warnings) showToast(warning, 'warning');
    return prompts;
  } catch (err) {
    showError('登録したプロンプトを読み込めませんでした', err);
    return null;
  }
}

/** Runs a change; resolves true after the success toast, false after the error toast. */
async function saveChange(
  change: () => Promise<{ warnings: string[] }>,
  success: string,
  failure: string,
): Promise<boolean> {
  try {
    const { warnings } = await change();
    for (const warning of warnings) showToast(warning, 'warning');
    showToast(success, 'success');
    return true;
  } catch (err) {
    showError(failure, err);
    return false;
  }
}

/** Name + text editor. `onSave` gets the trimmed name; the dialog closes when it resolves true. */
function openPromptEditor(opts: {
  title: string;
  name: string;
  text: string;
  saveLabel: string;
  onSave: (name: string, text: string) => Promise<boolean>;
}): void {
  const nameInput = h('input', {
    type: 'text',
    class: 'cs-input',
    value: opts.name,
    maxLength: MAX_NAME_LENGTH,
    placeholder: '例: 着彩（線画を維持）',
  });
  const textarea = h('textarea', { class: 'cs-textarea prompt-editor__text', value: opts.text });
  const modal = createModal({ title: opts.title, overlayClass: OVERLAY_CLASS, closeOnBackdrop: false });
  const dispose: () => void = escapeClosable(modal.overlay, () => dispose());
  const save = button(
    opts.saveLabel,
    async () => {
      const error = promptInputError(nameInput.value, textarea.value);
      if (error) {
        showToast(error, 'warning');
        return;
      }
      save.disabled = true;
      try {
        if (await opts.onSave(nameInput.value.trim(), textarea.value)) dispose();
      } finally {
        save.disabled = false;
      }
    },
    { variant: 'primary', size: 'dialog' },
  );
  modal.panel.append(
    field('名前', nameInput),
    field('本文', textarea),
    h(
      'div',
      { class: 'cs-modal__actions' },
      button('キャンセル', dispose, { variant: 'outline', size: 'dialog' }),
      save,
    ),
  );
  modal.open();
  (opts.name ? textarea : nameInput).focus();
}

/** Registers `text` under a new name; a name already registered is overwritten after a confirmation. */
export function openRegisterDialog(tool: string, text: string): void {
  openPromptEditor({
    title: 'プロンプトを登録',
    name: '',
    text,
    saveLabel: '登録',
    onSave: async (name, body) => {
      const prompts = await fetchPrompts(tool);
      if (!prompts) return false;
      const existing = findByName(prompts, name);
      if (!existing) {
        return saveChange(
          () => createPrompt(tool, name, body),
          `プロンプト「${name}」を登録しました`,
          'プロンプトを登録できませんでした',
        );
      }
      const overwrite = await confirmDialog({
        title: 'プロンプトの上書き',
        message: `「${name}」はすでに登録されています。上書きしますか？`,
        confirmLabel: '上書き',
      });
      if (!overwrite) return false;
      return saveChange(
        () => updatePrompt(tool, existing.id, name, body),
        `プロンプト「${name}」を上書きしました`,
        'プロンプトを上書きできませんでした',
      );
    },
  });
}

/** The tool's registered prompts; 使う passes the text to `onUse` and closes the list. */
export function openPromptLibrary(tool: string, onUse: (text: string) => void): void {
  const modal = createModal({ title: '登録したプロンプト', overlayClass: OVERLAY_CLASS, closeOnBackdrop: false });
  const dispose: () => void = escapeClosable(modal.overlay, () => dispose());
  const list = h('div', { class: 'prompt-library' }, h('div', { class: 'prompt-library__empty', text: '読み込み中…' }));

  const refresh = async () => {
    const prompts = await fetchPrompts(tool);
    if (!modal.overlay.isConnected) return;
    if (!prompts) {
      list.replaceChildren(h('div', { class: 'prompt-library__empty', text: '読み込めませんでした。' }));
    } else if (prompts.length === 0) {
      list.replaceChildren(
        h('div', {
          class: 'prompt-library__empty',
          text: '登録されたプロンプトはありません。プロンプト欄の「登録」ボタンから追加できます。',
        }),
      );
    } else {
      list.replaceChildren(...prompts.map(item));
    }
  };

  const edit = (prompt: SavedPrompt) =>
    openPromptEditor({
      title: 'プロンプトを編集',
      name: prompt.name,
      text: prompt.text,
      saveLabel: '保存',
      onSave: async (name, body) => {
        const prompts = await fetchPrompts(tool);
        if (!prompts) return false;
        if (findByName(prompts, name, prompt.id)) {
          showToast(`同じ名前のプロンプト「${name}」が登録されています。`, 'warning');
          return false;
        }
        const saved = await saveChange(
          () => updatePrompt(tool, prompt.id, name, body),
          `プロンプト「${name}」を保存しました`,
          'プロンプトを保存できませんでした',
        );
        void refresh();
        return saved;
      },
    });

  const remove = async (prompt: SavedPrompt) => {
    const ok = await confirmDialog({
      title: 'プロンプトの削除',
      message: `「${prompt.name}」を削除しますか？`,
      confirmLabel: '削除',
    });
    if (!ok) return;
    await saveChange(
      () => deletePrompt(tool, prompt.id),
      `プロンプト「${prompt.name}」を削除しました`,
      'プロンプトを削除できませんでした',
    );
    void refresh();
  };

  const item = (prompt: SavedPrompt) =>
    h(
      'div',
      { class: 'prompt-library__item' },
      h(
        'div',
        { class: 'prompt-library__body' },
        h('div', { class: 'prompt-library__name', text: prompt.name }),
        h('div', { class: 'prompt-library__preview', text: previewText(prompt.text), title: prompt.text }),
      ),
      h(
        'div',
        { class: 'prompt-library__actions' },
        button(
          '使う',
          () => {
            dispose();
            onUse(prompt.text);
            showToast(`プロンプト「${prompt.name}」を読み込みました`);
          },
          { variant: 'primary', size: 'small' },
        ),
        button('編集', () => edit(prompt), { size: 'small' }),
        button('削除', () => void remove(prompt), { size: 'small' }),
      ),
    );

  modal.panel.append(
    list,
    h('div', { class: 'cs-modal__actions' }, button('閉じる', dispose, { variant: 'outline', size: 'dialog' })),
  );
  modal.open();
  void refresh();
}
