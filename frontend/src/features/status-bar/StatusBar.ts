/**
 * StatusBar — tool progress (left) and backend / internet / Gemini key status (right).
 * Backend and Gemini status are polled every 10s.
 */
import './status-bar.css';
import { getGeminiKeyStatus } from '../../shared/api/settings';
import { BACKEND_ORIGIN, isBackendHealthy } from '../../shared/api/system';
import { on } from '../../shared/events';
import { h, setShown } from '../../shared/ui/dom';

const POLL_INTERVAL_MS = 10000;

function statusItem(initial: string) {
  const dot = h('span', { class: 'statusbar__status-dot' });
  const text = document.createTextNode(initial);
  return {
    el: h('div', { class: 'statusbar__status-item' }, dot, text),
    set(ok: boolean, label: string) {
      dot.classList.toggle('statusbar__status-dot--ok', ok);
      dot.classList.toggle('statusbar__status-dot--error', !ok);
      text.textContent = label;
    },
  };
}

export function createStatusBar(): HTMLElement {
  const statusText = h('span', { text: 'Ready' });
  const progress = h(
    'div',
    { class: 'statusbar__progress', style: { display: 'none' } },
    h('div', { class: 'statusbar__progress-fill' }),
  );

  const backend = statusItem('Backend: Checking...');
  const internet = statusItem('');
  const gemini = statusItem('Gemini API: Checking...');

  const updateBackend = async () => {
    const ok = await isBackendHealthy();
    backend.set(ok, ok ? `Backend: ${BACKEND_ORIGIN}` : 'Backend: Offline');
  };
  const updateInternet = () => {
    internet.set(navigator.onLine, `Internet: ${navigator.onLine ? 'Online' : 'Offline'}`);
  };
  const updateGemini = async () => {
    try {
      const { has_key } = await getGeminiKeyStatus();
      gemini.set(has_key, has_key ? 'Gemini API: Ready' : 'Gemini API: Missing Key');
    } catch {
      gemini.set(false, 'Gemini API: Backend Error');
    }
  };

  void updateBackend();
  updateInternet();
  void updateGemini();
  setInterval(updateBackend, POLL_INTERVAL_MS);
  setInterval(updateGemini, POLL_INTERVAL_MS);
  window.addEventListener('online', updateInternet);
  window.addEventListener('offline', updateInternet);
  on('settings:updated', () => void updateGemini());

  on('tool:start', ({ toolName }) => {
    statusText.textContent = `Running: ${toolName}...`;
    setShown(progress, true, 'block');
  });
  on('tool:progress', ({ message }) => {
    statusText.textContent = message;
  });
  on('tool:end', () => {
    statusText.textContent = 'Ready';
    setShown(progress, false);
  });

  return h(
    'footer',
    { class: 'statusbar' },
    h('div', { class: 'statusbar__left' }, statusText, progress),
    h('div', { class: 'statusbar__right' }, backend.el, internet.el, gemini.el),
  );
}
