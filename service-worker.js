// 域名匹配函数：支持通配符 *.example.com 和精确匹配
function matchDomain(url, pattern) {
  if (!url || !pattern) return false;
  try {
    const hostname = new URL(url).hostname;
    const p = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
    return new RegExp('^' + p + '$', 'i').test(hostname);
  } catch {
    return false;
  }
}

async function getTargetDomains() {
  const local = await chrome.storage.local.get('settings');
  const domains = local.settings?.targetDomains;
  if (domains?.length) return domains;
  const sync = await chrome.storage.sync.get('settings');
  return sync.settings?.targetDomains || [];
}

// 检查 URL 是否匹配任意配置的域名（未配置域名时默认匹配所有页面）
async function isMatchedDomain(url) {
  const targetDomains = await getTargetDomains();
  if (!targetDomains.length) return true;
  return targetDomains.some(pattern => matchDomain(url, pattern));
}

// 通用 AI API 调用（兼容 OpenAI 格式）
async function callAI(apiKey, model, messages, baseUrl) {
  const url = baseUrl || 'https://api.deepseek.com/v1/chat/completions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'deepseek-v4-pro',
      messages,
      temperature: 0.7,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API 请求失败: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_DOMAIN') {
    isMatchedDomain(message.url).then(matched => sendResponse({ matched }));
    return true;
  }

  if (message.type === 'AI_REQUEST') {
    const { apiKey, model, systemPrompt, content, baseUrl } = message;
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content });

    callAI(apiKey, model, messages, baseUrl)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 视觉模型请求（图片 OCR）
  if (message.type === 'VISION_REQUEST') {
    const { apiKey, model, baseUrl, imageBase64, prompt } = message;

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || '请提取这张图片中的所有文字内容，保持原有格式和排版。只输出文字，不要额外说明。' },
        { type: 'image_url', image_url: { url: imageBase64 } }
      ]
    }];

    callAI(apiKey, model || 'gpt-4o', messages, baseUrl)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'EXTRACT_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT' }, (response) => {
          sendResponse(response || { success: false, error: '无法连接到页面' });
        });
      } else {
        sendResponse({ success: false, error: '未找到活动标签页' });
      }
    });
    return true;
  }

  if (message.type === 'FILL_TO_PAGE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FILL', text: message.text }, (response) => {
          sendResponse(response || { success: false, error: '无法连接到页面' });
        });
      } else {
        sendResponse({ success: false, error: '未找到活动标签页' });
      }
    });
    return true;
  }
});
