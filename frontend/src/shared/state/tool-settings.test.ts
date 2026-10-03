import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getToolSettings: vi.fn(),
  updateToolSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({ showToast: vi.fn(), showError: vi.fn() }));
vi.mock('../api/settings', () => api);
vi.mock('../ui/toast', () => toast);

const { loadSettings, saveSettings, toolSettings } = await import('./tool-settings');

describe('tool settings', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.getToolSettings.mockResolvedValue({ values: { a_prompt: '保存済み', b_model: 'x' }, warnings: [] });
    api.updateToolSettings.mockResolvedValue({ warnings: [] });
    await loadSettings();
  });

  it('changes values only in memory until the tool saves them', async () => {
    const a = toolSettings('a');
    a.set('prompt', '新しい');
    expect(a.get('prompt', '')).toBe('新しい');
    expect(api.updateToolSettings).not.toHaveBeenCalled();

    expect(await saveSettings('a')).toBe(true);
    expect(api.updateToolSettings).toHaveBeenCalledWith({ a_prompt: '新しい' });

    // Nothing left to save.
    await saveSettings('a');
    expect(api.updateToolSettings).toHaveBeenCalledTimes(1);
  });

  it('saves only the changed keys of the given tool', async () => {
    toolSettings('a').set('prompt', 'A');
    toolSettings('b').set('model', 'y');
    toolSettings('ab').set('x', 'not a_'); // "ab_x" is not under the prefix "a"

    await saveSettings('a');

    expect(api.updateToolSettings).toHaveBeenCalledWith({ a_prompt: 'A' });
  });

  it('saves chosen keys right away for explicit saves', async () => {
    const a = toolSettings('a');
    a.set('prompt', 'typed');
    a.set('defaultPrompt', 'new default');

    await a.save(['defaultPrompt']);

    expect(api.updateToolSettings).toHaveBeenCalledWith({ a_defaultPrompt: 'new default' });
  });

  it('drops unsaved changes when the settings are read again (a tool window opens)', async () => {
    const a = toolSettings('a');
    a.set('prompt', '未保存');

    await loadSettings();

    expect(a.get('prompt', '')).toBe('保存済み');
    await saveSettings('a');
    expect(api.updateToolSettings).not.toHaveBeenCalled();
  });

  it('keeps the changes unsaved and shows an error when saving fails', async () => {
    api.updateToolSettings.mockRejectedValueOnce(new Error('disk full'));
    toolSettings('a').set('prompt', 'A');

    expect(await saveSettings('a')).toBe(false);
    expect(toast.showError).toHaveBeenCalledWith('ツールの設定を保存できませんでした', expect.any(Error));

    await saveSettings('a');
    expect(api.updateToolSettings).toHaveBeenLastCalledWith({ a_prompt: 'A' });
  });

  it('shows the warnings of the backend (a broken settings file)', async () => {
    api.getToolSettings.mockResolvedValueOnce({ values: {}, warnings: ['壊れていたため退避しました'] });

    await loadSettings();

    expect(toast.showToast).toHaveBeenCalledWith('壊れていたため退避しました', 'warning');
  });
});
