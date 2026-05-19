// ============================================================
// 公共模块 — 侧边栏和 Popup 共享的逻辑
// ============================================================

// --- 默认设置 ---
export const defaults = {
  apiKey: 'sk-a213cddfe27e4562acc8ccb86874a312',
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  visionBaseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'deepseek-v4-pro',
  visionModel: 'gpt-4o',
  targetDomains: [],
  systemPrompt: '',
  userPrompt: '请分析以下网页内容，并根据内容生成合适的回复或总结：\n\n页面标题：{{title}}\n\n页面内容：\n{{content}}',
  speechLang: 'zh-CN'
};

// ========== 设置管理 (local + sync 双写) ==========

export async function getSettings() {
  const local = await chrome.storage.local.get('settings');
  if (local.settings) return { ...defaults, ...local.settings };

  const sync = await chrome.storage.sync.get('settings');
  if (sync.settings) return { ...defaults, ...sync.settings };

  return { ...defaults };
}

export async function saveSettings(settings) {
  const data = { ...defaults, ...settings };
  await chrome.storage.local.set({ settings: data });
  // 同步到 sync（API Key 不放入 sync 以保证安全）
  const { apiKey, ...syncData } = data;
  await chrome.storage.sync.set({ settings: syncData }).catch(() => {});
}

export async function saveApiKey(apiKey) {
  await chrome.storage.local.set({ apiKey });
}

export async function getApiKey() {
  const result = await chrome.storage.local.get('apiKey');
  return result.apiKey || '';
}

// ========== 历史记录管理 (sync) ==========

const MAX_HISTORY = 20;

export async function getHistory() {
  const result = await chrome.storage.sync.get('history');
  return result.history || [];
}

export async function addHistory(entry) {
  const history = await getHistory();
  // 截断结果以避免超过 sync 存储限制 (8KB/item)
  const safeResult = (entry.result || '').slice(0, 2000);
  history.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    ...entry,
    result: safeResult
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.sync.set({ history }).catch(() => {});
}

export async function clearHistory() {
  await chrome.storage.sync.set({ history: [] }).catch(() => {});
}

// ========== 备忘录管理 (sync) ==========

export async function getMemos() {
  const result = await chrome.storage.sync.get('memos');
  return result.memos || [];
}

export async function addMemo(memo) {
  const memos = await getMemos();
  memos.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    title: (memo.title || '').slice(0, 200),
    content: (memo.content || '').slice(0, 5000),
    color: memo.color || 'default'
  });
  await chrome.storage.sync.set({ memos }).catch(() => {});
  return memos;
}

export async function updateMemo(id, updates) {
  const memos = await getMemos();
  const idx = memos.findIndex(m => m.id === id);
  if (idx === -1) return null;
  if (updates.title !== undefined) updates.title = updates.title.slice(0, 200);
  if (updates.content !== undefined) updates.content = updates.content.slice(0, 5000);
  memos[idx] = { ...memos[idx], ...updates, updatedAt: Date.now() };
  await chrome.storage.sync.set({ memos }).catch(() => {});
  return memos[idx];
}

export async function deleteMemo(id) {
  const memos = await getMemos();
  const filtered = memos.filter(m => m.id !== id);
  await chrome.storage.sync.set({ memos: filtered }).catch(() => {});
  return filtered;
}

// ========== Service Worker 通信 ==========

export async function checkDomain(url) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'CHECK_DOMAIN', url });
    return resp?.matched || false;
  } catch {
    return false;
  }
}

export async function extractContent() {
  return await chrome.runtime.sendMessage({ type: 'EXTRACT_CONTENT' });
}

export async function callAI({ apiKey, model, systemPrompt, content, baseUrl }) {
  return await chrome.runtime.sendMessage({
    type: 'AI_REQUEST',
    apiKey, model, systemPrompt, content, baseUrl
  });
}

export async function callVision({ apiKey, model, baseUrl, imageBase64, prompt }) {
  return await chrome.runtime.sendMessage({
    type: 'VISION_REQUEST',
    apiKey,
    model,
    baseUrl,
    imageBase64,
    prompt
  });
}

export async function fillToPage(text) {
  return await chrome.runtime.sendMessage({ type: 'FILL_TO_PAGE', text });
}

// ========== 语音识别 ==========

let recognition = null;
let isListening = false;
let onVoiceResult = null;
let onVoiceEnd = null;
let silenceTimer = null;

export function isVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startVoice(lang, onResult, onEnd) {
  if (isListening) return false;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;

  recognition = new SR();
  recognition.lang = lang || 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  onVoiceResult = onResult;
  onVoiceEnd = onEnd;

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (onVoiceResult) onVoiceResult(transcript, event.results[event.results.length - 1]?.isFinal);
    // 有语音输入时重置静音计时器
    resetSilenceTimer();
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    console.warn('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      if (onVoiceResult) onVoiceResult('', true);
      stopVoice();
    }
  };

  recognition.onend = () => {
    isListening = false;
    clearTimeout(silenceTimer);
    if (onVoiceEnd) onVoiceEnd();
  };

  recognition.start();
  isListening = true;
  resetSilenceTimer();
  return true;
}

function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    stopVoice();
  }, 3000);
}

export function stopVoice() {
  clearTimeout(silenceTimer);
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  isListening = false;
}

export function getVoiceState() {
  return isListening;
}

// ========== 图片处理 ==========

export function triggerImagePick(capture) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files[0];
      document.body.removeChild(input);
      if (file) resolve(file);
      else reject(new Error('未选择图片'));
    });

    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      reject(new Error('取消选择'));
    });

    input.click();
  });
}

export async function compressImage(file, maxSize = 2048, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxSize && height <= maxSize) {
          resolve(e.target.result);
          return;
        }
        const scale = maxSize / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function base64ToBlob(base64, mime = 'image/jpeg') {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

// ========== 工具函数 ==========

export function $(sel, parent) {
  return (parent || document).querySelector(sel);
}

export function showToast(msg, type) {
  // 由各自的 UI 实现，这里提供默认实现
  const ev = new CustomEvent('toast', { detail: { msg, type: type || 'success' } });
  window.dispatchEvent(ev);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
