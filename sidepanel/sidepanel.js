// ============================================================
// 侧边栏逻辑 — 使用公共模块
// ============================================================

import {
  defaults, getSettings, saveSettings, getApiKey, saveApiKey,
  getHistory, addHistory, clearHistory,
  checkDomain, extractContent, callAI, callVision, fillToPage,
  isVoiceSupported, startVoice, stopVoice, getVoiceState,
  triggerImagePick, compressImage
} from '../lib/common.js';

// --- DOM ---
const S = (sel) => document.querySelector(sel);

const domainStatus = S('#domainStatus');
const pageTitle = S('#pageTitle');
const contentPreview = S('#contentPreview');
const resultPreview = S('#resultPreview');
const contentCount = S('#contentCount');
const resultCount = S('#resultCount');
const extractBtn = S('#extractBtn');
const cameraBtn = S('#cameraBtn');
const voiceBtn = S('#voiceBtn');
const analyzeBtn = S('#analyzeBtn');
const autoBtn = S('#autoBtn');
const fillBtn = S('#fillBtn');
const progressBar = S('#progressBar');
const toast = S('#toast');

const settingsPanel = S('#settingsPanel');
const historyPanel = S('#historyPanel');
const historyList = S('#historyList');
const toggleSettings = S('#toggleSettings');
const toggleHistory = S('#toggleHistory');
const saveSettingsBtn = S('#saveSettings');
const resetSettingsBtn = S('#resetSettings');
const toggleApiKeyBtn = S('#toggleApiKey');
const clearHistoryBtn = S('#clearHistory');

let settings = { ...defaults };
let isTargetDomain = false;
let currentTabId = null;
let voiceActive = false;

// --- 初始化 ---
async function init() {
  settings = await getSettings();
  applySettingsToUI();
  await checkCurrentTab();

  if (!isVoiceSupported()) {
    voiceBtn.style.display = 'none';
  }
}

function applySettingsToUI() {
  S('#apiKey').value = settings.apiKey || '';
  S('#baseUrl').value = settings.baseUrl || defaults.baseUrl;
  S('#model').value = settings.model || defaults.model;
  S('#visionModel').value = settings.visionModel || defaults.visionModel;
  S('#targetDomains').value = (settings.targetDomains || []).join('\n');
  S('#speechLang').value = settings.speechLang || 'zh-CN';
  S('#systemPrompt').value = settings.systemPrompt || '';
  S('#userPrompt').value = settings.userPrompt || defaults.userPrompt;
}

async function collectSettings() {
  settings.apiKey = S('#apiKey').value.trim();
  settings.baseUrl = S('#baseUrl').value.trim() || defaults.baseUrl;
  settings.model = S('#model').value;
  settings.visionModel = S('#visionModel').value;
  settings.targetDomains = S('#targetDomains').value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.speechLang = S('#speechLang').value;
  settings.systemPrompt = S('#systemPrompt').value.trim();
  settings.userPrompt = S('#userPrompt').value.trim();
  await saveSettings(settings);
  await saveApiKey(settings.apiKey);
}

// --- 域名检测 ---
async function checkCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return;
    currentTabId = tabs[0].id;
    pageTitle.textContent = tabs[0].title || '';

    const hasDomains = settings.targetDomains?.length > 0;
    isTargetDomain = await checkDomain(tabs[0].url);

    if (isTargetDomain && !hasDomains) {
      domainStatus.textContent = '🌐 全部页面可用';
      domainStatus.className = 'status-tag matched';
    } else if (isTargetDomain) {
      domainStatus.textContent = '✅ 已匹配域名';
      domainStatus.className = 'status-tag matched';
    } else {
      domainStatus.textContent = '⚠️ 未匹配域名';
      domainStatus.className = 'status-tag unmatched';
    }
    updateButtons();
  } catch (e) {
    domainStatus.textContent = '⚠️ 检测失败';
  }
}

function updateButtons() {
  extractBtn.disabled = !isTargetDomain;
  cameraBtn.disabled = !isTargetDomain;
  voiceBtn.disabled = !isTargetDomain;
  analyzeBtn.disabled = !(isTargetDomain && contentPreview.value.trim());
  autoBtn.disabled = !isTargetDomain;
  fillBtn.disabled = !(isTargetDomain && resultPreview.value.trim());

  voiceBtn.textContent = voiceActive ? '🔴 停止录音' : '🎤 语音输入';
  voiceBtn.className = voiceActive ? 'btn btn-voice active' : 'btn btn-voice';
}

// --- 操作 ---
async function doExtract() {
  showProgress('正在提取...');
  try {
    const resp = await extractContent();
    hideProgress();
    if (resp?.success) {
      contentPreview.value = resp.content;
      contentCount.textContent = `${resp.content.length} 字符`;
      updateButtons();
      showToast('提取成功');
    } else {
      showToast('提取失败: ' + (resp?.error || ''), 'error');
    }
  } catch (e) {
    hideProgress();
    showToast('提取失败: ' + e.message, 'error');
  }
}

async function doAnalyze() {
  const content = contentPreview.value.trim();
  if (!content) { showToast('请先获取内容', 'error'); return; }
  if (!settings.apiKey) { showToast('请先配置 API Key', 'error'); return; }

  const userPrompt = settings.userPrompt
    .replace(/\{\{content\}\}/g, content)
    .replace(/\{\{title\}\}/g, pageTitle.textContent || '');

  showProgress('AI 分析中...');
  analyzeBtn.disabled = true;
  autoBtn.disabled = true;

  try {
    const resp = await callAI({
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
      content: userPrompt,
      baseUrl: settings.baseUrl
    });

    hideProgress();
    if (resp?.success) {
      resultPreview.value = resp.result;
      resultCount.textContent = `${resp.result.length} 字符`;
      fillBtn.disabled = false;

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await addHistory({
        url: tabs[0]?.url || '',
        title: tabs[0]?.title || '',
        prompt: userPrompt.slice(0, 300),
        result: resp.result,
        type: 'text'
      });

      showToast('AI 生成完成');
    } else {
      showToast('失败: ' + (resp?.error || ''), 'error');
    }
  } catch (e) {
    hideProgress();
    showToast('请求失败: ' + e.message, 'error');
  }

  analyzeBtn.disabled = false;
  autoBtn.disabled = false;
  updateButtons();
}

async function doFill(text) {
  const t = text || resultPreview.value.trim();
  if (!t) { showToast('请先生成文本', 'error'); return; }

  showProgress('填入中...');
  try {
    const resp = await fillToPage(t);
    hideProgress();
    resp?.success ? showToast('已填入') : showToast('填入失败: ' + (resp?.error || ''), 'error');
  } catch (e) {
    hideProgress();
    showToast('填入失败: ' + e.message, 'error');
  }
}

async function doAuto() {
  showProgress('1/3 提取内容...');
  try {
    const extractResp = await extractContent();
    if (!extractResp?.success) {
      hideProgress();
      showToast('提取失败: ' + (extractResp?.error || ''), 'error');
      return;
    }
    contentPreview.value = extractResp.content;
    contentCount.textContent = `${extractResp.content.length} 字符`;

    showProgress('2/3 AI 分析...');
    const userPrompt = settings.userPrompt
      .replace(/\{\{content\}\}/g, extractResp.content)
      .replace(/\{\{title\}\}/g, pageTitle.textContent || '');

    const aiResp = await callAI({
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
      content: userPrompt,
      baseUrl: settings.baseUrl
    });

    if (!aiResp?.success) {
      hideProgress();
      showToast('AI 失败: ' + (aiResp?.error || ''), 'error');
      return;
    }
    resultPreview.value = aiResp.result;
    resultCount.textContent = `${aiResp.result.length} 字符`;

    showProgress('3/3 填入页面...');
    const fillResp = await fillToPage(aiResp.result);

    hideProgress();
    fillResp?.success ? showToast('✅ 完成') : showToast('⚠️ 生成成功，填入失败', 'error');

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    await addHistory({
      url: tabs[0]?.url || '',
      title: tabs[0]?.title || '',
      prompt: userPrompt.slice(0, 300),
      result: aiResp.result,
      type: 'auto'
    });

    updateButtons();
  } catch (e) {
    hideProgress();
    showToast('失败: ' + e.message, 'error');
  }
}

// --- 拍照识图 ---
async function doCamera() {
  try {
    const file = await triggerImagePick(true);
    showProgress('处理图片...');
    const base64 = await compressImage(file);
    showProgress('识别文字中...');

    if (!settings.apiKey) {
      hideProgress();
      showToast('请先配置 API Key', 'error');
      return;
    }

    const resp = await callVision({
      apiKey: settings.apiKey,
      model: settings.visionModel,
      baseUrl: settings.baseUrl,
      imageBase64: base64
    });

    hideProgress();
    if (resp?.success) {
      contentPreview.value = resp.result;
      contentCount.textContent = `${resp.result.length} 字符`;
      updateButtons();
      showToast('识别完成');
    } else {
      showToast('识别失败: ' + (resp?.error || ''), 'error');
    }
  } catch (e) {
    hideProgress();
    if (e.message !== '取消选择') {
      showToast('拍照失败: ' + e.message, 'error');
    }
  }
}

// --- 语音输入 ---
function toggleVoice() {
  if (voiceActive) {
    stopVoice();
    voiceActive = false;
    updateButtons();
    return;
  }

  voiceActive = true;
  updateButtons();

  const started = startVoice(
    settings.speechLang || 'zh-CN',
    (transcript, isFinal) => {
      const activeEl = document.activeElement;
      const target = (activeEl === resultPreview) ? resultPreview : contentPreview;
      if (isFinal) {
        target.value = (target.value + ' ' + transcript).trim();
      }
    },
    () => {
      voiceActive = false;
      updateButtons();
    }
  );

  if (!started) {
    voiceActive = false;
    updateButtons();
    showToast('语音功能不可用（需要 HTTPS 环境）', 'error');
  }
}

// --- 历史记录 ---
async function loadHistoryUI() {
  const history = await getHistory();
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-hint">暂无历史记录</p>';
    return;
  }
  historyList.innerHTML = history.map(h => `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-time">${new Date(h.timestamp).toLocaleString('zh-CN')}</span>
        <span class="history-url">${h.url || ''}</span>
      </div>
      <div class="history-text">${(h.result || '').slice(0, 200)}${(h.result?.length > 200) ? '...' : ''}</div>
      <div class="history-actions-row">
        <button class="btn-sm btn-use" data-result="${encodeURIComponent(h.result || '')}">复制结果</button>
        <button class="btn-sm btn-fill" data-result="${encodeURIComponent(h.result || '')}">填入页面</button>
      </div>
    </div>
  `).join('');

  historyList.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', () => {
      resultPreview.value = decodeURIComponent(btn.dataset.result);
      resultCount.textContent = `${resultPreview.value.length} 字符`;
      updateButtons();
      showToast('已加载历史结果');
    });
  });
  historyList.querySelectorAll('.btn-fill').forEach(btn => {
    btn.addEventListener('click', () => doFill(decodeURIComponent(btn.dataset.result)));
  });
}

// --- UI ---
function showProgress(msg) {
  progressBar.classList.remove('hidden');
  const fill = progressBar.querySelector('.progress-fill');
  fill.style.width = '0%';
  requestAnimationFrame(() => {
    fill.style.width = '90%';
    fill.style.transition = 'width 15s ease-in-out';
  });
}

function hideProgress() {
  const fill = progressBar.querySelector('.progress-fill');
  fill.style.width = '100%';
  fill.style.transition = 'width 0.2s ease';
  setTimeout(() => {
    progressBar.classList.add('hidden');
    fill.style.width = '0%';
    fill.style.transition = 'none';
  }, 300);
}

function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className = `toast ${type} visible`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// --- 事件绑定 ---
extractBtn.addEventListener('click', doExtract);
analyzeBtn.addEventListener('click', doAnalyze);
autoBtn.addEventListener('click', doAuto);
fillBtn.addEventListener('click', () => doFill());
cameraBtn.addEventListener('click', doCamera);
voiceBtn.addEventListener('click', toggleVoice);

contentPreview.addEventListener('input', () => {
  if (contentPreview.value !== undefined) {
    contentCount.textContent = `${contentPreview.value.length} 字符`;
  }
  updateButtons();
});
resultPreview.addEventListener('input', () => {
  if (resultPreview.value !== undefined) {
    resultCount.textContent = `${resultPreview.value.length} 字符`;
  }
  updateButtons();
});

// 设置
toggleSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
  if (!settingsPanel.classList.contains('hidden')) historyPanel.classList.add('hidden');
});

toggleHistory.addEventListener('click', () => {
  historyPanel.classList.toggle('hidden');
  if (!historyPanel.classList.contains('hidden')) {
    settingsPanel.classList.add('hidden');
    loadHistoryUI();
  }
});

toggleApiKeyBtn.addEventListener('click', () => {
  S('#apiKey').type = S('#apiKey').type === 'password' ? 'text' : 'password';
});

saveSettingsBtn.addEventListener('click', async () => {
  await collectSettings();
  settings = await getSettings();
  await checkCurrentTab();
  showToast('设置已保存');
});

resetSettingsBtn.addEventListener('click', () => {
  settings = { ...defaults };
  applySettingsToUI();
  showToast('已重置');
});

clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('确定清空所有历史记录？')) {
    await clearHistory();
    await loadHistoryUI();
    showToast('历史已清空');
  }
});

// ========== 以下为 sidepanel.js 中 extractContent 和 fillToPage 的重载版本 ==========
// 注：这些函数现在通过 service worker 中继，所以直接调用 chrome.runtime.sendMessage

// 标签切换监听
chrome.tabs.onActivated.addListener(() => checkCurrentTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && tabId === currentTabId) {
    checkCurrentTab();
  }
});

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    doAuto();
  }
});

init();
