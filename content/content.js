// --- 页面内容提取 ---

function extractContent() {
  const doc = document;

  // 1. 尝试通过自定义选择器提取
  const selectors = [
    'article', '[role="main"]', 'main',
    '.post-content', '.article-content', '.entry-content', '.content',
    '#content', '#article', '#post', '.post', '.article',
    '.markdown-body', '.prose', '.rich-text'
  ];

  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim().length > 100) {
      return cleanText(el.textContent);
    }
  }

  // 2. 移除无关元素后从 body 提取
  const clone = doc.body.cloneNode(true);
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'header', 'footer', 'aside',
    '.nav', '.navbar', '.navigation', '.menu',
    '.sidebar', '.widget', '.advertisement', '.ad', '.ads',
    '.footer', '.header',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.comment', '.comments', '#comments',
    '.social-share', '.share',
    '.related-posts', '.recommended'
  ];

  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => el.remove());
  });

  const text = clone.textContent || '';
  return cleanText(text);
}

function cleanText(text) {
  return text
    .replace(/[\t\r\n]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- 文本填入 ---

function findEditableElement() {
  const doc = document;

  // 先检查当前焦点元素
  const active = doc.activeElement;
  if (isEditable(active)) {
    return active;
  }

  // 按优先级查找
  return (
    doc.querySelector('[contenteditable="true"]') ||
    doc.querySelector('textarea') ||
    doc.querySelector('input[type="text"]:not([readonly])') ||
    doc.querySelector('input[type="search"]:not([readonly])') ||
    doc.querySelector('[role="textbox"]')
  );
}

function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'textarea') return !el.readOnly && !el.disabled;
  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email'].includes(type) && !el.readOnly && !el.disabled;
  }
  if (el.getAttribute?.('role') === 'textbox') return true;
  if (typeof el.value === 'string' && el.tagName?.toLowerCase() !== 'select') return !el.readOnly && !el.disabled;
  return false;
}

function fillText(element, text) {
  if (!element) return false;

  // contenteditable / 富文本编辑器
  if (element.isContentEditable || element.getAttribute?.('role') === 'textbox') {
    element.focus();
    // 尝试使用 execCommand 兼容旧编辑器
    if (document.execCommand) {
      element.innerHTML = '';
      element.focus();

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        document.execCommand('insertText', false, lines[i]);
        if (i < lines.length - 1) {
          document.execCommand('insertParagraph', false, null);
        }
      }
    } else {
      element.textContent = text;
    }
    // 触发 input 事件让框架响应
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return true;
  }

  // input / textarea
  if (element.value !== undefined) {
    element.focus();
    element.value = text;
    // 触发原生 input 事件
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element), 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(element, text);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return true;
  }

  return false;
}

// --- 消息处理 ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT') {
    try {
      const content = extractContent();
      const title = document.title || '';
      const url = window.location.href;
      sendResponse({ success: true, content, title, url });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return;
  }

  if (message.type === 'FILL') {
    try {
      const el = findEditableElement();
      if (!el) {
        sendResponse({ success: false, error: '页面中未找到可输入的文本框' });
        return;
      }
      const ok = fillText(el, message.text);
      sendResponse({ success: ok, filled: ok });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return;
  }
});
