const scriptListEl = document.getElementById('scriptList');
const editorTitleEl = document.getElementById('editorTitle');
const scriptNameInput = document.getElementById('scriptNameInput');
const scriptContent = document.getElementById('scriptContent');
const scheduleInput = document.getElementById('scheduleInput');
const scheduleUnitSelect = document.getElementById('scheduleUnitSelect');
const startTimeInput = document.getElementById('startTimeInput');
const endTimeInput = document.getElementById('endTimeInput');
const runModeSelect = document.getElementById('runModeSelect');
const maxRunsInput = document.getElementById('maxRunsInput');
const logOutput = document.getElementById('logOutput');
const themeToggle = document.getElementById('themeToggle');
const scheduleFields = document.getElementById('scheduleFields');
const timeRangeFields = document.getElementById('timeRangeFields');
const maxRunsField = document.getElementById('maxRunsField');

const summaryTotal = document.getElementById('summary-total');
const summaryRunning = document.getElementById('summary-running');
const summaryScheduled = document.getElementById('summary-scheduled');
const summaryStatus = document.getElementById('summary-status');

// 爬虫参数控件
const crawlerParams = document.getElementById('crawlerParams');
const crawlerBrowser = document.getElementById('crawlerBrowser');
const crawlerClickMode = document.getElementById('crawlerClickMode');
const crawlerWaitAfterClick = document.getElementById('crawlerWaitAfterClick');
const crawlerHeadless = document.getElementById('crawlerHeadless');
const crawlerFollowLink = document.getElementById('crawlerFollowLink');

let scripts = [];
let selectedName = null;
let editingDirty = false;
let saveTimer = null;
let isSaving = false;

function applyTheme(theme) {
  document.body.classList.toggle('theme-night', theme === 'night');
  themeToggle.textContent = theme === 'night' ? '切换白天模式' : '切换夜间模式';
  localStorage.setItem('dashboard-theme', theme);
}

function updateRunModeState() {
  const mode = runModeSelect.value;
  // 间隔值/间隔单位：所有模式都显示
  scheduleFields.style.display = '';
  // 开始/结束时间：仅区间运行显示
  timeRangeFields.style.display = mode === 'interval' ? '' : 'none';
  // 运行次数：仅有限次数显示
  maxRunsField.style.display = mode === 'limited' ? '' : 'none';
}

function markEditorDirty() {
  editingDirty = true;
}

function markEditorClean() {
  editingDirty = false;
}

function normalizeCrawlerTargetUrl(rawTargetUrl) {
  const value = (rawTargetUrl || '').trim();
  if (!value) {
    return '';
  }
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function scheduleAutoSave() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveScript(true);
  }, 1200);
}

function resetEditor(name = 'new_task.py') {
  markEditorClean();
  scriptNameInput.value = name;
  scriptContent.value = 'import time\n\nprint("hello from dashboard")\nfor i in range(3):\n    print(f"tick {i}")\n    time.sleep(1)\n';
  scheduleInput.value = '';
  scheduleUnitSelect.value = 'minute';
  startTimeInput.value = '';
  endTimeInput.value = '';
  runModeSelect.value = 'continuous';
  maxRunsInput.value = '';
  updateRunModeState();
  logOutput.textContent = '请选择或新建脚本';
  editorTitleEl.textContent = '脚本编辑器';
  document.getElementById('resultContent').innerHTML = '<span class="result-placeholder">请选择或新建脚本</span>';
  document.getElementById('resultFileName').textContent = '';
  crawlerParams.style.display = 'none';
}

function renderSummary() {
  const running = scripts.filter(script => script.status === '运行中').length;
  const scheduled = scripts.filter(script => Number(script.scheduleValue) > 0 || script.startTime || script.endTime).length;
  summaryTotal.textContent = String(scripts.length);
  summaryRunning.textContent = String(running);
  summaryScheduled.textContent = String(scheduled);
  if (selectedName) {
    const current = scripts.find(script => script.name === selectedName);
    summaryStatus.textContent = current ? current.status : '未选择';
  } else {
    summaryStatus.textContent = '未选择';
  }
}

function renderScriptList() {
  if (!scripts.length) {
    scriptListEl.innerHTML = '<div class="script-item"><strong>暂无脚本</strong><div class="script-meta">点击右上角“新建脚本”开始</div></div>';
    return;
  }

  scriptListEl.innerHTML = scripts.map(script => {
    const modeLabels = { continuous: '一直运行', interval: '区间运行', limited: '有限次数' };
    const modeLabel = modeLabels[script.runMode] || script.runMode;
    let scheduleInfo = '';
    if (script.runMode === 'continuous' && script.scheduleValue) {
      scheduleInfo = `间隔：${script.scheduleValue} ${script.scheduleUnit === 'hour' ? '小时' : '分钟'}`;
    } else if (script.runMode === 'interval' && script.scheduleValue) {
      scheduleInfo = `间隔：${script.scheduleValue} ${script.scheduleUnit === 'hour' ? '小时' : '分钟'} | ${script.startTime || '--'}~${script.endTime || '--'}`;
    } else if (script.runMode === 'limited' && script.scheduleValue) {
      scheduleInfo = `间隔：${script.scheduleValue} ${script.scheduleUnit === 'hour' ? '小时' : '分钟'} | 共${script.maxRuns}次`;
    } else {
      scheduleInfo = '手动';
    }
    return `
    <div class="script-item ${selectedName === script.name ? 'active' : ''}" data-name="${script.name}">
      <div class="script-item-main">
        <strong>${script.name}</strong>
        <button class="delete-script-btn" data-name="${script.name}" type="button">删除</button>
      </div>
      <div class="script-meta">模式：${modeLabel}<br/>状态：${script.status || '未启动'}<br/>调度：${scheduleInfo}<br/>最近：${script.lastStartedAt ? new Date(script.lastStartedAt).toLocaleString() : '尚未运行'}</div>
    </div>`;
  }).join('');
}

async function loadScripts(skipEditorReload = false) {
  const response = await fetch('/api/scripts');
  const data = await response.json();
  scripts = data.scripts || [];
  renderSummary();
  renderScriptList();

  if (!selectedName && scripts.length) {
    selectedName = scripts[0].name;
  }

  if (selectedName && !skipEditorReload) {
    const current = scripts.find(script => script.name === selectedName);
    if (current && !editingDirty) {
      await fillEditor(current.name);
    }
  }
}

async function fillEditor(name) {
  const response = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
  const data = await response.json();
  markEditorClean();
  scriptNameInput.value = data.name;
  scriptContent.value = data.content || '';
  scheduleInput.value = data.scheduleValue || data.scheduleMinutes || '';
  scheduleUnitSelect.value = data.scheduleUnit || 'minute';
  startTimeInput.value = data.startTime || '';
  endTimeInput.value = data.endTime || '';
  runModeSelect.value = data.runMode || 'continuous';
  maxRunsInput.value = data.maxRuns || '';
  updateRunModeState();
  logOutput.textContent = data.lastOutput || '暂无日志';
  editorTitleEl.textContent = data.name;

  // 加载爬虫参数（如果是爬虫脚本：scriptType为crawler_selector，或内容包含爬虫特征）
  const isCrawler = data.scriptType === 'crawler_selector' || !!data.targetUrl || (data.content && data.content.includes('playwright.sync_api'));
  if (isCrawler) {
    crawlerParams.style.display = '';
    crawlerBrowser.value = data.browser || 'msedge';
    crawlerClickMode.value = data.clickMode || 'click';
    crawlerWaitAfterClick.value = data.waitAfterClick || 2;
    crawlerHeadless.checked = data.headless === true;
    crawlerFollowLink.checked = data.followLink === true;
  } else {
    crawlerParams.style.display = 'none';
  }

  // 加载最新生成结果
  await loadLatestResult();
}

scriptListEl.addEventListener('click', async event => {
  const deleteButton = event.target.closest('.delete-script-btn');
  if (deleteButton) {
    const name = deleteButton.dataset.name;
    if (window.confirm(`确定删除脚本 ${name} 吗？`)) {
      await deleteScript(name);
    }
    return;
  }

  const item = event.target.closest('.script-item');
  if (!item) {
    return;
  }
  selectedName = item.dataset.name;
  renderScriptList();
  await fillEditor(selectedName);
  renderSummary();
});

function getScriptPayload() {
  const payload = {
    content: scriptContent.value,
    scheduleValue: Number(scheduleInput.value) || 0,
    scheduleUnit: scheduleUnitSelect.value,
    scheduleMinutes: Number(scheduleInput.value) || 0,
    startTime: startTimeInput.value,
    endTime: endTimeInput.value,
    runMode: runModeSelect.value,
    maxRuns: Number(maxRunsInput.value) || 0
  };

  // 如果是爬虫脚本，附带爬虫参数
  if (crawlerParams.style.display !== 'none') {
    payload.browser = crawlerBrowser.value;
    payload.clickMode = crawlerClickMode.value;
    payload.waitAfterClick = parseFloat(crawlerWaitAfterClick.value) || 2;
    payload.headless = crawlerHeadless.checked;
    payload.followLink = crawlerFollowLink.checked;
  }

  return payload;
}

async function saveScript(silent = false) {
  if (isSaving) {
    return;
  }

  const name = scriptNameInput.value.trim();
  if (!name) {
    if (!silent) {
      alert('请先输入脚本名');
    }
    return;
  }

  isSaving = true;
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  // 如果是爬虫脚本，同步更新脚本代码中的 headless 和 followLink 变量
  if (crawlerParams.style.display !== 'none') {
    const headless = crawlerHeadless.checked ? 'True' : 'False';
    const followLink = crawlerFollowLink.checked ? 'True' : 'False';
    let code = scriptContent.value;
    // 替换 HEADLESS = True/False
    if (/HEADLESS\s*=/.test(code)) {
      code = code.replace(/^(HEADLESS\s*=\s*)(True|False)/m, `$1${headless}`);
    }
    // 替换 headless=True/False (旧格式)
    code = code.replace(/(headless=)(True|False)/gi, `$1${headless}`);
    // 替换 FOLLOW_LINK = True/False
    if (/FOLLOW_LINK\s*=/.test(code)) {
      code = code.replace(/^(FOLLOW_LINK\s*=\s*)(True|False)/m, `$1${followLink}`);
    }
    scriptContent.value = code;
  }

  try {
    const response = await fetch(`/api/scripts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getScriptPayload())
    });

    const data = await response.json();
    if (!data.success) {
      if (!silent) {
        alert(data.message || '保存失败');
      }
      return;
    }

    selectedName = name;
    markEditorClean();
    await loadScripts();
    if (!silent) {
      alert(data.message || '已保存');
    }
  } finally {
    isSaving = false;
  }
}

async function deleteScript(name) {
  if (!name) {
    return;
  }

  const response = await fetch(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' });
  const data = await response.json();
  alert(data.message || '已删除');
  if (selectedName === name) {
    selectedName = null;
  }
  await loadScripts();
  if (!selectedName && scripts.length) {
    selectedName = scripts[0]?.name || null;
  }
  if (selectedName) {
    await fillEditor(selectedName);
  } else {
    resetEditor();
  }
  renderSummary();
}

async function startScript() {
  const name = scriptNameInput.value.trim();
  if (!name) {
    alert('请选择或输入脚本名');
    return;
  }

  const response = await fetch(`/api/scripts/${encodeURIComponent(name)}/start`, { method: 'POST' });
  const data = await response.json();
  alert(data.message || '已请求启动');
  await loadScripts();
}

async function stopScript() {
  const name = scriptNameInput.value.trim();
  if (!name) {
    alert('请选择或输入脚本名');
    return;
  }

  const response = await fetch(`/api/scripts/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  const data = await response.json();
  alert(data.message || '已请求停止');
  await loadScripts();
}

function openCrawlerSetupWindow() {
  // 如果当前有选中的爬虫脚本，将参数传递给新建页面
  const params = new URLSearchParams();
  const currentScript = scripts.find(s => s.name === selectedName);
  if (currentScript) {
    if (currentScript.scriptType === 'crawler_selector' || currentScript.targetUrl) {
      params.set('scriptName', currentScript.name.replace(/\.py$/i, ''));
      params.set('targetUrl', currentScript.targetUrl || '');
      params.set('headless', currentScript.headless ? 'true' : 'false');
      params.set('followLink', currentScript.followLink ? 'true' : 'false');
      params.set('browser', currentScript.browser || 'msedge');
      params.set('clickMode', currentScript.clickMode || 'click');
      params.set('waitAfterClick', String(currentScript.waitAfterClick || 2));
    }
  }
  const queryStr = params.toString();
  const url = queryStr ? `/crawler-setup.html?${queryStr}` : '/crawler-setup.html';
  const popup = window.open(url, '_blank', 'width=640,height=430');
  if (!popup) {
    alert('请允许浏览器弹出新窗口');
    return;
  }
}

async function createNewScript(scriptType = 'normal') {
  if (scriptType === 'crawler_selector') {
    openCrawlerSetupWindow();
    return;
  }
  const name = window.prompt('请输入新的脚本名称，例如 daily_report.py', 'new_task.py');
  if (!name) {
    return;
  }
  selectedName = name;
  resetEditor(name);
}

['input', 'change'].forEach(eventName => {
  [scriptNameInput, scriptContent, scheduleInput, scheduleUnitSelect, startTimeInput, endTimeInput, runModeSelect, maxRunsInput].forEach(element => {
    element.addEventListener(eventName, () => {
      markEditorDirty();
      scheduleAutoSave();
    });
  });
});

runModeSelect.addEventListener('change', () => {
  updateRunModeState();
  markEditorDirty();
  scheduleAutoSave();
});
themeToggle.addEventListener('click', () => {
  const nextTheme = document.body.classList.contains('theme-night') ? 'day' : 'night';
  applyTheme(nextTheme);
});

window.addEventListener('message', async event => {
  if (event.origin && event.origin !== window.location.origin) {
    return;
  }
  if (event.data?.type === 'crawler-created' && event.data.scriptName) {
    selectedName = event.data.scriptName;
    await loadScripts();
    await fillEditor(selectedName);
    renderSummary();
  }
});

async function openDataDir() {
  const name = scriptNameInput.value.trim();
  if (!name) {
    alert('请先选择或输入脚本名');
    return;
  }

  // 先查询数据目录信息
  const infoResp = await fetch(`/api/scripts-data-dir?name=${encodeURIComponent(name)}`);
  const info = await infoResp.json();

  if (!info.success) {
    alert(info.message || '获取数据目录失败');
    return;
  }

  if (!info.exists || info.files.length === 0) {
    const confirmCreate = window.confirm(
      `数据目录尚无文件：${info.dir}\n\n是否仍然打开此文件夹？`
    );
    if (!confirmCreate) return;
  }

  // 调用 API 在文件管理器中打开
  const resp = await fetch(`/api/scripts/${encodeURIComponent(name)}/open-dir`, { method: 'POST' });
  const data = await resp.json();
  if (!data.success) {
    alert(data.message || '打开文件夹失败');
  }
}

async function loadLatestResult() {
  const name = scriptNameInput.value.trim();
  const resultContentEl = document.getElementById('resultContent');
  const resultFileNameEl = document.getElementById('resultFileName');

  // 保存当前滚动位置
  const savedScrollTop = resultContentEl.scrollTop;

  if (!name) {
    resultContentEl.innerHTML = '<span class="result-placeholder">请先选择脚本</span>';
    resultFileNameEl.textContent = '';
    return;
  }

  try {
    const resp = await fetch(`/api/scripts-latest-result?name=${encodeURIComponent(name)}`);
    const data = await resp.json();

    if (!data.success || !data.hasResult) {
      resultContentEl.innerHTML = '<span class="result-placeholder">暂无生成结果，运行脚本后将在此显示</span>';
      resultFileNameEl.textContent = '';
      return;
    }

    resultFileNameEl.textContent = `📄 ${data.fileName}`;
    const result = data.result;

    // 构建结果展示 HTML
    let html = '';

    // 目标网址
    if (result.target_url) {
      html += `<div class="result-field"><span class="result-label">目标网址：</span><a href="${result.target_url}" target="_blank" class="result-url">${result.target_url}</a></div>`;
    }

    // 页面标题
    if (result.page_title) {
      html += `<div class="result-field"><span class="result-label">页面标题：</span><span class="result-value">${result.page_title}</span></div>`;
    }

    // 时间戳
    if (result.timestamp) {
      html += `<div class="result-field"><span class="result-label">抓取时间：</span><span class="result-value">${result.timestamp}</span></div>`;
    }

    // 跟随链接状态
    if (result.follow_link_enabled !== undefined) {
      html += `<div class="result-field"><span class="result-label">跟随链接：</span><span class="result-value">${result.follow_link_enabled ? '是' : '否'}</span></div>`;
    }

    // 优先展示每个区域点击后获取的链接内容（selections）
    if (result.selections && result.selections.length > 0) {
      html += `<div class="section-title" style="font-size:13px;font-weight:700;color:#64748b;margin:16px 0 8px 0;padding-bottom:4px;border-bottom:1px solid #e2e8f0;">📋 各区域抓取结果（${result.selections.length} 个）</div>`;
      result.selections.forEach((sel, idx) => {
        html += `<div class="result-selection-block" style="margin-bottom:12px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">`;
        html += `<div style="font-weight:600;font-size:14px;margin-bottom:4px;">📍 区域 #${idx + 1}</div>`;
        if (sel.text) {
          html += `<div class="result-field"><span class="result-label">点击文本：</span><span class="result-value">${escapeHtml(sel.text.slice(0, 100))}</span></div>`;
        }
        if (sel.href) {
          html += `<div class="result-field"><span class="result-label">链接：</span><a href="${sel.href}" target="_blank" class="result-url">${sel.href}</a></div>`;
        }
        // 显示跟随链接后获取的文章内容
        if (sel.followed_article && sel.followed_article.title) {
          html += `<div class="result-field" style="margin-top:6px;"><span class="result-label" style="color:#0891b2;">📄 链接页面文章：</span></div>`;
          html += `<div style="font-size:13px;color:#1e293b;margin:4px 0 2px 0;"><strong>标题：</strong>${escapeHtml(sel.followed_article.title)}</div>`;
          if (sel.followed_article.source) {
            html += `<div style="font-size:12px;color:#64748b;">来源：${escapeHtml(sel.followed_article.source)}</div>`;
          }
          if (sel.followed_article.date) {
            html += `<div style="font-size:12px;color:#64748b;">日期：${escapeHtml(sel.followed_article.date)}</div>`;
          }
          if (sel.followed_article.content) {
            const articleContent = sel.followed_article.content.length > 1500
              ? sel.followed_article.content.slice(0, 1500) + '\n\n... (内容过长，已截断)'
              : sel.followed_article.content;
            html += `<pre class="result-text" style="margin-top:4px;max-height:300px;overflow-y:auto;font-size:13px;line-height:1.6;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:8px;">${escapeHtml(articleContent)}</pre>`;
          }
        } else if (sel.followed_content) {
          // 兼容旧格式
          const fc = sel.followed_content.length > 1500
            ? sel.followed_content.slice(0, 1500) + '\n\n... (内容过长，已截断)'
            : sel.followed_content;
          html += `<pre class="result-text" style="margin-top:4px;max-height:300px;overflow-y:auto;">${escapeHtml(fc)}</pre>`;
        }
        html += `</div>`;
      });
    }

    // 点击的元素信息（单区域模式兼容）
    if (result.clicked_element) {
      html += `<div class="result-field"><span class="result-label">点击元素：</span><span class="result-value">${result.clicked_element.text || result.clicked_element.css_selector || '—'}</span></div>`;
    }

    // 跟随链接的文章（单区域模式兼容）
    if (result.followed_article && result.followed_article.title && !result.selections) {
      html += `<div class="result-field result-content-block"><span class="result-label" style="color:#0891b2;">📄 链接页面文章：</span>`;
      html += `<div style="font-size:13px;color:#1e293b;margin:4px 0;"><strong>${escapeHtml(result.followed_article.title)}</strong></div>`;
      if (result.followed_article.content) {
        const ac = result.followed_article.content.length > 2000
          ? result.followed_article.content.slice(0, 2000) + '\n\n... (内容过长，已截断)'
          : result.followed_article.content;
        html += `<pre class="result-text">${escapeHtml(ac)}</pre>`;
      }
      html += `</div>`;
    }

    // 页面内容（仅当没有 selections 时作为兜底显示，截取前 1000 字符）
    if (result.page_content && !result.selections) {
      const content = result.page_content.length > 1000
        ? result.page_content.slice(0, 1000) + '\n\n... (内容过长，已截断)'
        : result.page_content;
      html += `<div class="result-field result-content-block"><span class="result-label">页面内容：</span><pre class="result-text">${escapeHtml(content)}</pre></div>`;
    }

    if (!html) {
      html = '<span class="result-placeholder">结果数据格式无法显示</span>';
    }

    resultContentEl.innerHTML = html;

    // 恢复滚动位置（使用 requestAnimationFrame 确保 DOM 更新后再恢复）
    if (savedScrollTop > 0) {
      requestAnimationFrame(() => {
        resultContentEl.scrollTop = savedScrollTop;
      });
    }
  } catch (err) {
    resultContentEl.innerHTML = `<span class="result-placeholder">加载结果失败：${err.message}</span>`;
    resultFileNameEl.textContent = '';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.getElementById('refreshButton').addEventListener('click', () => loadScripts(false));
document.getElementById('newScriptButton').addEventListener('click', createNewScript);
document.getElementById('newCrawlerButton').addEventListener('click', () => createNewScript('crawler_selector'));
document.getElementById('saveButton').addEventListener('click', saveScript);
document.getElementById('startButton').addEventListener('click', startScript);
document.getElementById('stopButton').addEventListener('click', stopScript);
document.getElementById('openDataDirButton').addEventListener('click', openDataDir);
document.getElementById('refreshResultButton').addEventListener('click', loadLatestResult);

const storedTheme = localStorage.getItem('dashboard-theme') || 'day';
applyTheme(storedTheme);
updateRunModeState();
resetEditor();
loadScripts();
// 定时刷新脚本列表和状态（跳过编辑器/结果面板刷新，避免导航条滚动位置重置）
setInterval(() => {
  loadScripts(true);
}, 3000);
