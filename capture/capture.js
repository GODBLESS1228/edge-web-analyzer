// ============================================================
// Capture 页面 — 拍照识图 & 语音输入（Popup 关闭后不中断）
// ============================================================

import {
  getSettings, addHistory,
  isVoiceSupported, startVoice, stopVoice,
  compressImage, callVision
} from '../lib/common.js';

const S = (sel) => document.querySelector(sel);

// 从 URL 参数获取模式
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'camera';

// DOM
const modeTitle = S('#modeTitle');
const cameraMode = S('#cameraMode');
const voiceMode = S('#voiceMode');
const fileInput = S('#fileInput');
const captureArea = S('#captureArea');
const imagePreview = S('#imagePreview');
const previewImg = S('#previewImg');
const retakeBtn = S('#retakeBtn');
const ocrResult = S('#ocrResult');
const ocrText = S('#ocrText');
const useOcrBtn = S('#useOcrBtn');
const cameraProgress = S('#cameraProgress');
const cameraStatus = S('#cameraStatus');

const voiceToggle = S('#voiceToggle');
const voiceIcon = S('#voiceIcon');
const voiceLabel = S('#voiceLabel');
const voiceHint = S('#voiceHint');
const voiceResult = S('#voiceResult');
const voiceText = S('#voiceText');
const clearVoiceBtn = S('#clearVoiceBtn');
const useVoiceBtn = S('#useVoiceBtn');
const voiceStatus = S('#voiceStatus');
const toast = S('#toast');

let settings = {};
let voiceActive = false;

// --- 初始化 ---
async function init() {
  settings = await getSettings();

  if (mode === 'voice') {
    cameraMode.classList.add('hidden');
    voiceMode.classList.remove('hidden');
    modeTitle.textContent = '🎤 语音输入';

    if (!isVoiceSupported()) {
      S('#voiceToggle').disabled = true;
      voiceHint.textContent = '⚠️ 当前浏览器不支持语音识别';
    }
  } else {
    cameraMode.classList.remove('hidden');
    voiceMode.classList.add('hidden');
    modeTitle.textContent = '📷 拍照识图';
  }
}

// --- 拍照识图 ---
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // 预览
  const reader = new FileReader();
  reader.onload = (ev) => {
    previewImg.src = ev.target.result;
    captureArea.classList.add('hidden');
    imagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);

  // 压缩并 OCR
  showCameraProgress('正在处理图片...');
  try {
    const base64 = await compressImage(file);
    showCameraProgress('正在识别文字...');

    if (!settings.apiKey) {
      hideCameraProgress();
      cameraStatus.textContent = '⚠️ 请先配置 API Key';
      return;
    }

    const resp = await callVision({
      apiKey: settings.apiKey,
      model: settings.visionModel,
      baseUrl: settings.visionBaseUrl,
      imageBase64: base64
    });

    hideCameraProgress();

    if (resp?.success) {
      ocrText.value = resp.result;
      ocrResult.classList.remove('hidden');
      cameraStatus.textContent = '✅ 识别完成';
    } else {
      cameraStatus.textContent = '❌ 识别失败: ' + (resp?.error || '');
    }
  } catch (err) {
    hideCameraProgress();
    cameraStatus.textContent = '❌ 处理失败: ' + err.message;
  }
});

retakeBtn.addEventListener('click', () => {
  imagePreview.classList.add('hidden');
  ocrResult.classList.add('hidden');
  captureArea.classList.remove('hidden');
  cameraStatus.textContent = '';
  fileInput.value = '';
});

useOcrBtn.addEventListener('click', async () => {
  const text = ocrText.value.trim();
  if (!text) {
    showToast('没有可用的文本', 'error');
    return;
  }

  // 存储结果供 popup/sidepanel 使用
  await chrome.storage.local.set({ pendingCaptureResult: text });

  // 添加历史
  await addHistory({
    url: '',
    title: '拍照识图',
    prompt: '图片 OCR 提取',
    result: text,
    type: 'ocr'
  });

  showToast('已保存，请返回');
  setTimeout(() => window.close(), 500);
});

// --- 语音输入 ---
voiceToggle.addEventListener('click', () => {
  if (voiceActive) {
    stopVoice();
    voiceActive = false;
    voiceIcon.textContent = '🎤';
    voiceLabel.textContent = '点击开始录音';
    voiceToggle.classList.remove('active');
    voiceStatus.textContent = '录音已停止';
    return;
  }

  if (!settings.apiKey) {
    // 语音不需要 API key，但可以检查
  }

  voiceActive = true;
  voiceIcon.textContent = '🔴';
  voiceLabel.textContent = '正在录音...点击停止';
  voiceToggle.classList.add('active');
  voiceResult.classList.remove('hidden');
  voiceStatus.textContent = '🎙️ 正在收听...';

  const started = startVoice(
    settings.speechLang || 'zh-CN',
    (transcript, isFinal) => {
      voiceText.value = transcript;
      if (isFinal) {
        voiceStatus.textContent = '✅ 识别中...';
      }
    },
    () => {
      voiceActive = false;
      voiceIcon.textContent = '🎤';
      voiceLabel.textContent = '点击开始录音';
      voiceToggle.classList.remove('active');
      voiceStatus.textContent = '录音结束';
    }
  );

  if (!started) {
    voiceActive = false;
    voiceIcon.textContent = '🎤';
    voiceLabel.textContent = '点击开始录音';
    voiceToggle.classList.remove('active');
    voiceStatus.textContent = '❌ 语音功能不可用';
  }
});

clearVoiceBtn.addEventListener('click', () => {
  voiceText.value = '';
  voiceStatus.textContent = '';
});

useVoiceBtn.addEventListener('click', async () => {
  const text = voiceText.value.trim();
  if (!text) {
    showToast('没有可用的文本', 'error');
    return;
  }

  await chrome.storage.local.set({ pendingCaptureResult: text });

  await addHistory({
    url: '',
    title: '语音输入',
    prompt: '语音转文字',
    result: text,
    type: 'voice'
  });

  showToast('已保存，请返回');
  setTimeout(() => window.close(), 500);
});

// --- 关闭 ---
S('#closeBtn').addEventListener('click', () => window.close());

// --- UI ---
function showCameraProgress(msg) {
  cameraProgress.classList.remove('hidden');
  cameraStatus.textContent = msg;
  const fill = cameraProgress.querySelector('.progress-fill');
  fill.style.width = '0%';
  requestAnimationFrame(() => {
    fill.style.width = '90%';
    fill.style.transition = 'width 15s ease-in-out';
  });
}

function hideCameraProgress() {
  const fill = cameraProgress.querySelector('.progress-fill');
  fill.style.width = '100%';
  fill.style.transition = 'width 0.2s ease';
  setTimeout(() => {
    cameraProgress.classList.add('hidden');
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

init();
