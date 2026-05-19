// ============================================================
// Popup 逻辑 — 使用公共模块
// ============================================================

import {
  defaults, getSettings, saveSettings, getApiKey, saveApiKey,
  getHistory, addHistory, clearHistory,
  checkDomain, extractContent, callAI, fillToPage
} from '../lib/common.js';

// --- DOM 引用 ---
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

// Settings
const settingsOverlay = S('#settingsOverlay');
const toggleSettings = S('#toggleSettings');
const closeSettings = S('#closeSettings');
const saveSettingsBtn = S('#saveSettings');
const resetSettingsBtn = S('#resetSettings');

// Tabs
const tabMain = S('#tabMain');
const tabHistory = S('#tabHistory');
const historyList = S('#historyList');

// Side panel
const openSidePanelBtn = S('#openSidePanel');

let settings = { ...defaults };
let isTargetDomain = false;

// --- 初始化 ---
async function init() {
  settings = await getSettings();
  applySettingsToUI();
  await loadHistory();
  await checkCurrentTab();

  // 检查是否有 capture 页面传回的结果（拍照/语音）
  const pending = await chrome.storage.local.get('pendingCaptureResult');
  if (pending.pendingCaptureResult) {
    contentPreview.value = pending.pendingCaptureResult;
    contentCount.textContent = `${pending.pendingCaptureResult.length} 字符`;
    await chrome.storage.local.remove('pendingCaptureResult');
    showToast('已加载拍照/语音结果');
  }

  // 如果语音不支持，隐藏按钮（改为打开 capture 页面，所以不需要判断）
}

async function checkCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return;
    const url = tabs[0].url;
    pageTitle.textContent = tabs[0].title || '';

    const hasDomains = settings.targetDomains?.length > 0;
    isTargetDomain = await checkDomain(url);

    if (isTargetDomain && !hasDomains) {
      domainStatus.textContent = '🌐 全部可用';
      domainStatus.className = 'status-tag matched';
    } else if (isTargetDomain) {
      domainStatus.textContent = '✅ 已匹配';
      domainStatus.className = 'status-tag matched';
    } else {
      domainStatus.textContent = '⚠️ 未匹配';
      domainStatus.className = 'status-tag unmatched';
    }

    updateButtons();
  } catch (e) {
    domainStatus.textContent = '⚠️ 错误';
  }
}

function updateButtons() {
  extractBtn.disabled = !isTargetDomain;
  cameraBtn.disabled = !isTargetDomain;
  voiceBtn.disabled = !isTargetDomain;
  analyzeBtn.disabled = !(isTargetDomain && contentPreview.value.trim());
  autoBtn.disabled = !isTargetDomain;
  fillBtn.disabled = !(isTargetDomain && resultPreview.value.trim());
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

  // 另外单独保存 apiKey（local only，安全）
  await saveApiKey(settings.apiKey);
}

// --- 历史记录 ---
async function loadHistory() {
  const history = await getHistory();
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-hint">暂无历史记录</p>';
    return;
  }
  historyList.innerHTML = history.map(h => `
    <div class="history-item" data-id="${h.id}">
      <div class="history-meta">
        <span class="history-time">${new Date(h.timestamp).toLocaleString('zh-CN')}</span>
        <span class="history-url">${h.url || ''}</span>
      </div>
      <div class="history-text">${h.result?.slice(0, 200) || ''}${(h.result?.length > 200) ? '...' : ''}</div>
      <div class="history-actions-row">
        <button class="btn-sm btn-use" data-id="${h.id}">复制结果</button>
        <button class="btn-sm btn-fill" data-id="${h.id}">填入页面</button>
      </div>
    </div>
  `).join('');

  // 绑定历史项事件
  historyList.querySelectorAll('.btn-use').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = history.find(h => h.id === btn.dataset.id);
      if (item) {
        resultPreview.value = item.result;
        resultCount.textContent = `${item.result.length} 字符`;
        updateButtons();
        showToast('已加载历史结果');
      }
    });
  });
  historyList.querySelectorAll('.btn-fill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = history.find(h => h.id === btn.dataset.id);
      if (item) {
        doFill(item.result);
      }
    });
  });
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
  if (!content) {
    showToast('请先获取内容', 'error');
    return;
  }
  if (!settings.apiKey) {
    showToast('请先配置 API Key', 'error');
    return;
  }

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

      // 同步历史
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
    if (resp?.success) {
      showToast('已填入');
    } else {
      showToast('填入失败: ' + (resp?.error || ''), 'error');
    }
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
    if (fillResp?.success) {
      showToast('✅ 完成');
    } else {
      showToast('⚠️ 生成成功，填入失败', 'error');
    }

    // 同步历史
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

// --- 拍照识图（打开专用页面，Popup 关闭后不中断）---
async function doCamera() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('capture/capture.html?mode=camera'),
    active: true
  });
}

// --- 语音输入（打开专用页面）---
function toggleVoice() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('capture/capture.html?mode=voice'),
    active: true
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

// 设置面板
toggleSettings.addEventListener('click', () => settingsOverlay.classList.remove('hidden'));
closeSettings.addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

saveSettingsBtn.addEventListener('click', async () => {
  await collectSettings();
  settings = await getSettings();
  await checkCurrentTab();
  settingsOverlay.classList.add('hidden');
  showToast('设置已保存');
});

resetSettingsBtn.addEventListener('click', () => {
  settings = { ...defaults };
  applySettingsToUI();
  showToast('已重置');
});

// 标签切换
S('.tabs').addEventListener('click', (e) => {
  if (!e.target.classList.contains('tab')) return;
  const tabName = e.target.dataset.tab;
  S('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  if (tabName === 'main') {
    tabMain.classList.remove('hidden');
    tabHistory.classList.add('hidden');
  } else {
    tabMain.classList.add('hidden');
    tabHistory.classList.remove('hidden');
    loadHistory();
  }
});

// 清空历史
S('#clearHistory').addEventListener('click', async () => {
  if (confirm('确定清空所有历史记录？')) {
    await clearHistory();
    await loadHistory();
    showToast('历史已清空');
  }
});

// 打开侧边栏
openSidePanelBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(() => {
        showToast('侧边栏打开失败，请在页面右键扩展图标选择"打开侧边栏"', 'error');
      });
    }
  });
});

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    doAuto();
  }
  if (e.ctrlKey && e.key === '1') {
    e.preventDefault();
    doExtract();
  }
  if (e.ctrlKey && e.key === '2') {
    e.preventDefault();
    doAnalyze();
  }
});

init();
