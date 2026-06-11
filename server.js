const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { buildGeneratedCrawlerScript, buildMultiSelectionScript, normalizeCrawlerTargetUrl } = require('./crawler-utils');

const rootDir = __dirname;
const scriptsDir = path.join(rootDir, 'scripts');
const dataDir = path.join(rootDir, 'data');
const stateFile = path.join(dataDir, 'scripts-state.json');
const port = process.env.PORT || 3000;

fs.mkdirSync(scriptsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

let state = { scripts: {} };
if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (error) {
    state = { scripts: {} };
  }
}

const activeProcesses = new Map();
const manuallyStopped = new Set();

function saveState() {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function normalizeMeta(meta) {
  meta.startTime = meta.startTime || '';
  meta.endTime = meta.endTime || '';
  meta.runMode = meta.runMode || 'continuous';
  meta.maxRuns = Number(meta.maxRuns) || 0;
  meta.runCount = Number(meta.runCount) || 0;
  meta.scheduleUnit = meta.scheduleUnit || 'minute';
  meta.scheduleValue = Number(meta.scheduleValue) || Number(meta.scheduleMinutes) || 0;
  meta.scheduleMinutes = meta.scheduleUnit === 'hour' ? Number(meta.scheduleValue) * 60 : Number(meta.scheduleValue);
  return meta;
}

function ensureMeta(name) {
  if (!state.scripts[name]) {
    state.scripts[name] = {
      name,
      status: '未启动',
      lastOutput: '',
      scheduleMinutes: 0,
      createdAt: new Date().toISOString()
    };
  }
  normalizeMeta(state.scripts[name]);
  return state.scripts[name];
}

function normalizeScriptName(name) {
  if (!name || name.includes('..') || path.isAbsolute(name)) {
    throw new Error('脚本名非法');
  }
  return name.endsWith('.py') ? name : `${name}.py`;
}

function getScriptPath(name) {
  const safeName = normalizeScriptName(name);
  return path.join(scriptsDir, safeName);
}

const HELPER_SCRIPTS = new Set(['网页区域选择爬虫.py']);

function listScripts() {
  const files = fs.readdirSync(scriptsDir).filter(file => file.endsWith('.py') && !HELPER_SCRIPTS.has(file));
  const items = files.map(file => {
    const meta = ensureMeta(file);
    meta.updatedAt = meta.updatedAt || new Date().toISOString();
    return {
      name: file,
      status: activeProcesses.has(file) ? '运行中' : meta.status || '未启动',
      scheduleValue: Number(meta.scheduleValue) || 0,
      scheduleUnit: meta.scheduleUnit || 'minute',
      scheduleMinutes: Number(meta.scheduleMinutes) || 0,
      startTime: meta.startTime || '',
      endTime: meta.endTime || '',
      runMode: meta.runMode || 'continuous',
      maxRuns: Number(meta.maxRuns) || 0,
      lastOutput: meta.lastOutput || '',
      lastStartedAt: meta.lastStartedAt || '',
      lastStoppedAt: meta.lastStoppedAt || '',
      lastExitCode: meta.lastExitCode || null,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      scriptType: meta.scriptType || 'normal',
      headless: meta.headless === true,
      browser: meta.browser || 'msedge',
      clickMode: meta.clickMode || 'click',
      waitAfterClick: Number(meta.waitAfterClick) || 2,
      userAgent: meta.userAgent || '',
      extraArgs: meta.extraArgs || '',
      followLink: meta.followLink === true
    };
  });

  const existingNames = new Set(items.map(item => item.name));
  Object.keys(state.scripts).forEach(key => {
    if (!existingNames.has(key)) {
      delete state.scripts[key];
    }
  });
  saveState();
  return items;
}

function readScriptContent(name) {
  const filePath = getScriptPath(name);
  if (!fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function writeScriptContent(name, content) {
  const filePath = getScriptPath(name);
  fs.writeFileSync(filePath, content, 'utf8');
  const meta = ensureMeta(name);
  meta.updatedAt = new Date().toISOString();
  saveState();
  return meta;
}

function deleteScript(name) {
  const safeName = normalizeScriptName(name);
  // 保护：禁止删除辅助脚本
  if (HELPER_SCRIPTS.has(safeName)) {
    return { success: false, message: '禁止删除系统辅助脚本' };
  }
  const filePath = getScriptPath(safeName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  if (state.scripts[safeName]) {
    delete state.scripts[safeName];
  }
  const child = activeProcesses.get(safeName);
  if (child) {
    child.kill('SIGTERM');
    activeProcesses.delete(safeName);
  }
  manuallyStopped.delete(safeName);
  saveState();
  return { success: true, message: '脚本已删除' };
}

function appendOutput(name, output) {
  const meta = ensureMeta(name);
  const nextOutput = `${meta.lastOutput || ''}${output}`;
  meta.lastOutput = nextOutput.slice(-4000);
  saveState();
}

function timeToMinutes(value) {
  if (!value) {
    return null;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isWithinTimeWindow(meta, now) {
  const start = timeToMinutes(meta.startTime);
  const end = timeToMinutes(meta.endTime);
  if (start === null && end === null) {
    return true;
  }
  if (start === null) {
    return now.getHours() * 60 + now.getMinutes() <= end;
  }
  if (end === null) {
    return now.getHours() * 60 + now.getMinutes() >= start;
  }
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= start && current <= end;
}

function getScheduleMinutes(meta) {
  const minutes = Number(meta.scheduleMinutes) || 0;
  if (meta.scheduleUnit === 'hour') {
    return Number(meta.scheduleValue || 0) * 60;
  }
  return minutes || Number(meta.scheduleValue || 0);
}

function shouldStartBySchedule(meta, now) {
  const intervalMinutes = getScheduleMinutes(meta);
  if (!intervalMinutes) {
    return false;
  }

  const mode = meta.runMode || 'continuous';

  // 区间运行：检查时间窗口
  if (mode === 'interval') {
    if (!isWithinTimeWindow(meta, now)) {
      return false;
    }
  }

  // 有限次数：检查运行次数
  if (mode === 'limited') {
    if (Number(meta.maxRuns) > 0 && Number(meta.runCount) >= Number(meta.maxRuns)) {
      return false;
    }
  }

  // 检查间隔时间
  const lastStarted = meta.lastStartedAt ? new Date(meta.lastStartedAt).getTime() : 0;
  return !lastStarted || now.getTime() - lastStarted >= intervalMinutes * 60 * 1000;
}

function getScriptDataDir(safeName) {
  const dirName = path.basename(safeName, '.py');
  return path.join(scriptsDir, dirName);
}

function ensureScriptDataDir(safeName) {
  const dataDir = getScriptDataDir(safeName);
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function startScript(name) {
  const safeName = normalizeScriptName(name);
  // 保护：禁止直接启动辅助脚本
  if (HELPER_SCRIPTS.has(safeName)) {
    return { success: false, message: '禁止直接运行系统辅助脚本' };
  }
  const meta = ensureMeta(safeName);
  const filePath = getScriptPath(safeName);

  if (!fs.existsSync(filePath)) {
    return { success: false, message: '脚本文件不存在，请先保存' };
  }

  if (activeProcesses.has(safeName)) {
    return { success: true, message: '脚本已经在运行' };
  }

  // 创建脚本专属数据目录
  const scriptDataDir = ensureScriptDataDir(safeName);
  console.log(`[server] 脚本数据目录: ${scriptDataDir}`);

  const command = process.platform === 'win32' ? 'py' : 'python3';
  const args = process.platform === 'win32'
    ? ['-3', '-u', '-X', 'utf8', filePath]
    : ['-u', '-X', 'utf8', filePath];
  const child = spawn(command, args, {
    cwd: scriptsDir,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  manuallyStopped.delete(safeName);
  activeProcesses.set(safeName, child);
  meta.status = '运行中';
  meta.lastOutput = '';
  meta.runCount = Number(meta.runCount || 0) + 1;
  meta.lastStartedAt = new Date().toISOString();
  meta.lastExitCode = null;
  saveState();

  child.stdout.on('data', chunk => {
    appendOutput(safeName, chunk);
  });

  child.stderr.on('data', chunk => {
    appendOutput(safeName, chunk);
  });

  child.on('error', error => {
    appendOutput(safeName, `\n[ERROR] ${error.message}\n`);
    activeProcesses.delete(safeName);
    manuallyStopped.delete(safeName);
    meta.status = '异常退出';
    meta.lastExitCode = 1;
    meta.lastStoppedAt = new Date().toISOString();
    saveState();
  });

  child.on('exit', code => {
    activeProcesses.delete(safeName);
    if (code === 0) {
      if (manuallyStopped.has(safeName)) {
        // 用户手动停止，显示"已停止"
        manuallyStopped.delete(safeName);
        meta.status = '已停止';
      } else {
        // 脚本自然结束，有调度则等待下次运行
        const hasSchedule = getScheduleMinutes(meta) > 0;
        meta.status = hasSchedule ? '等待下次运行' : '已停止';
      }
    } else {
      manuallyStopped.delete(safeName);
      meta.status = '异常退出';
    }
    meta.lastExitCode = code;
    meta.lastStoppedAt = new Date().toISOString();
    saveState();
  });

  return { success: true, message: '已启动', pid: child.pid };
}

function stopScript(name) {
  const safeName = normalizeScriptName(name);
  const meta = ensureMeta(safeName);
  const child = activeProcesses.get(safeName);
  if (!child) {
    meta.status = '未启动';
    saveState();
    return { success: true, message: '脚本当前未运行' };
  }

  manuallyStopped.add(safeName);
  child.kill('SIGTERM');
  meta.status = '停止中';
  saveState();
  return { success: true, message: '已发送停止信号' };
}

function checkScheduledScripts() {
  const now = new Date();
  Object.entries(state.scripts).forEach(([name, meta]) => {
    if (activeProcesses.has(name)) {
      return;
    }
    // 如果脚本有调度间隔，但状态不是"等待下次运行"，修正状态显示
    const intervalMinutes = getScheduleMinutes(meta);
    if (intervalMinutes > 0 && meta.status !== '运行中' && meta.status !== '等待下次运行') {
      // 检查是否在调度时间窗口内
      const mode = meta.runMode || 'continuous';
      let inWindow = true;
      if (mode === 'interval') {
        inWindow = isWithinTimeWindow(meta, now);
      }
      if (mode === 'limited') {
        if (Number(meta.maxRuns) > 0 && Number(meta.runCount) >= Number(meta.maxRuns)) {
          inWindow = false;
        }
      }
      if (inWindow) {
        meta.status = '等待下次运行';
        saveState();
      }
    }
    if (shouldStartBySchedule(meta, now)) {
      startScript(name);
    }
  });
}

setInterval(checkScheduledScripts, 30 * 1000);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'text/plain; charset=utf-8';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/scripts') {
    if (req.method === 'GET') {
      sendJson(res, 200, { scripts: listScripts() });
      return;
    }
  }

  if (pathname === '/api/crawler/create') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, message: '方法不允许' });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const scriptName = normalizeScriptName(payload.scriptName || payload.name || 'new_crawler');
        const targetUrl = normalizeCrawlerTargetUrl(payload.targetUrl || '');
        const headless = Boolean(payload.headless);
        const browser = payload.browser || 'msedge';
        const timeout = parseInt(payload.timeout) || 60;
        const clickMode = payload.clickMode || 'click';
        const waitAfterClick = parseFloat(payload.waitAfterClick) || 2;
        const userAgent = payload.userAgent || '';
        const extraArgs = payload.extraArgs || '';
        if (!targetUrl) {
          throw new Error('请先填写目标网址');
        }

        const selectionConfigPath = `${path.basename(scriptName, '.py')}_selection.json`;
        const outputPath = path.join(scriptsDir, selectionConfigPath);

        // 先保存 meta 信息
        const meta = ensureMeta(scriptName);
        meta.scriptType = 'crawler_selector';
        meta.targetUrl = targetUrl;
        meta.headless = headless;
        meta.browser = browser;
        meta.clickMode = clickMode;
        meta.waitAfterClick = waitAfterClick;
        meta.userAgent = userAgent;
        meta.extraArgs = extraArgs;
        meta.followLink = Boolean(payload.followLink);
        meta.updatedAt = new Date().toISOString();
        saveState();

        // 启动录制辅助脚本（交互式选择区域）
        const helperScriptPath = path.join(rootDir, 'scripts', '网页区域选择爬虫.py');
        if (!fs.existsSync(helperScriptPath)) {
          sendJson(res, 500, { success: false, message: '录制辅助脚本不存在，请检查 scripts/网页区域选择爬虫.py 文件' });
          return;
        }

        const command = process.platform === 'win32' ? 'py' : 'python3';
        const pyArgs = [
          '--url', targetUrl,
          '--output', outputPath,
          '--browser', browser,
          '--timeout', String(timeout),
          '--click-mode', clickMode,
          '--wait-after-click', String(waitAfterClick)
        ];
        if (headless) pyArgs.push('--headless');
        if (userAgent) { pyArgs.push('--user-agent'); pyArgs.push(userAgent); }
        if (extraArgs) { pyArgs.push('--extra-args'); pyArgs.push(extraArgs); }
        if (payload.multiSelect) { pyArgs.push('--multi-select'); }
        const args = process.platform === 'win32'
          ? ['-3', '-u', '-X', 'utf8', helperScriptPath, ...pyArgs]
          : ['-u', '-X', 'utf8', helperScriptPath, ...pyArgs];

        let responded = false;
        function finish(success, message, statusCode = 200, extra = {}) {
          if (responded) {
            return;
          }
          responded = true;
          sendJson(res, statusCode, { success, message, name: scriptName, ...extra });
        }

        const child = spawn(command, args, {
          cwd: scriptsDir,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
          stdio: ['inherit', 'pipe', 'pipe']
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });

        child.on('error', error => {
          finish(false, `启动区域录制失败：${error.message}`, 500);
        });

        // 先返回成功响应，让前端知道爬虫已启动
        finish(true, '浏览器已打开，请在终端中操作：点击网页上的目标区域，然后按 Enter 获取选择，输入 done 结束录制', 200, { outputPath });

        child.on('close', code => {
          if (code !== 0) {
            console.error(`[crawler] 录制进程退出 code=${code}, stderr=${stderr.slice(-500)}`);
            return;
          }

          // 录制完成，读取 selection JSON，动态生成最终脚本
          try {
            const selectionRaw = fs.readFileSync(outputPath, 'utf8');
            const selectionData = JSON.parse(selectionRaw);
            const selections = selectionData.selections || (selectionData.selection ? [selectionData.selection] : []);
            if (selections.length === 0) {
              console.error('[crawler] 录制数据中缺少选择区域');
              return;
            }

            // 尝试读取链接页面区域选择
            let linkSelections = [];
            const linkSelPath = path.join(scriptsDir, `${path.basename(scriptName, '.py')}_link_selection.json`);
            if (fs.existsSync(linkSelPath)) {
              try {
                const linkSelRaw = fs.readFileSync(linkSelPath, 'utf8');
                const linkSelData = JSON.parse(linkSelRaw);
                linkSelections = linkSelData.selections || (linkSelData.selection ? [linkSelData.selection] : []);
              } catch (e) {}
            }

            const generatedContent = buildMultiSelectionScript(
              scriptName, targetUrl, selections,
              { browser: payload.browser, clickMode: payload.clickMode, waitAfterClick: payload.waitAfterClick, userAgent: payload.userAgent, headless: payload.headless, followLink: payload.followLink, linkSelections }
            );
            const filePath = getScriptPath(scriptName);
            fs.writeFileSync(filePath, generatedContent, 'utf8');

            console.log(`[crawler] 爬虫脚本已生成: ${scriptName} (${selections.length} 个区域)`);
          } catch (err) {
            console.error(`[crawler] 生成脚本失败：${err.message}`);
          }
        });
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
      }
    });
    return;
  }

  // 链接页面区域录制 API
  if (pathname === '/api/crawler/create-link-selection') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, message: '方法不允许' });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const scriptName = normalizeScriptName(payload.scriptName || payload.name || 'new_crawler');
        const targetUrl = normalizeCrawlerTargetUrl(payload.targetUrl || '');
        const headless = Boolean(payload.headless);
        const browser = payload.browser || 'msedge';
        const timeout = parseInt(payload.timeout) || 60;
        const clickMode = payload.clickMode || 'click';
        const waitAfterClick = parseFloat(payload.waitAfterClick) || 2;
        const userAgent = payload.userAgent || '';
        const extraArgs = payload.extraArgs || '';
        const selections = payload.selections || [];

        if (!targetUrl) {
          throw new Error('请先填写目标网址');
        }
        if (selections.length === 0) {
          throw new Error('请先录制主页面区域');
        }

        // 使用第一个选择的链接作为示例进入链接页面
        const firstSel = selections[0];
        const firstHref = firstSel.href || '';
        if (!firstHref) {
          sendJson(res, 400, { success: false, message: '选择的区域没有链接，请选择包含链接的区域' });
          return;
        }

        // 拼接完整 URL
        let linkUrl = firstHref;
        if (!linkUrl.startsWith('http')) {
          if (linkUrl.startsWith('/')) {
            const parsed = new URL(targetUrl);
            linkUrl = `${parsed.protocol}//${parsed.host}${linkUrl}`;
          } else {
            linkUrl = targetUrl + linkUrl;
          }
        }

        const linkSelectionConfigPath = `${path.basename(scriptName, '.py')}_link_selection.json`;
        const outputPath = path.join(scriptsDir, linkSelectionConfigPath);

        // 启动录制辅助脚本（在链接页面上选择区域）
        const helperScriptPath = path.join(rootDir, 'scripts', '网页区域选择爬虫.py');
        if (!fs.existsSync(helperScriptPath)) {
          sendJson(res, 500, { success: false, message: '录制辅助脚本不存在' });
          return;
        }

        const command = process.platform === 'win32' ? 'py' : 'python3';
        const pyArgs = [
          '--url', linkUrl,
          '--output', outputPath,
          '--browser', browser,
          '--timeout', String(timeout),
          '--click-mode', clickMode,
          '--wait-after-click', String(waitAfterClick)
        ];
        if (headless) pyArgs.push('--headless');
        if (userAgent) { pyArgs.push('--user-agent'); pyArgs.push(userAgent); }
        if (extraArgs) { pyArgs.push('--extra-args'); pyArgs.push(extraArgs); }
        pyArgs.push('--multi-select');
        const args = process.platform === 'win32'
          ? ['-3', '-u', '-X', 'utf8', helperScriptPath, ...pyArgs]
          : ['-u', '-X', 'utf8', helperScriptPath, ...pyArgs];

        let responded = false;
        function finish(success, message, statusCode = 200, extra = {}) {
          if (responded) return;
          responded = true;
          sendJson(res, statusCode, { success, message, name: scriptName, ...extra });
        }

        const child = spawn(command, args, {
          cwd: scriptsDir,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
          stdio: ['inherit', 'pipe', 'pipe']
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });

        child.on('error', error => {
          finish(false, `启动链接页面录制失败：${error.message}`, 500);
        });

        finish(true, '链接页面浏览器已打开，请在终端中操作', 200, { outputPath });

        child.on('close', code => {
          if (code !== 0) {
            console.error(`[crawler-link] 录制进程退出 code=${code}, stderr=${stderr.slice(-500)}`);
            return;
          }
          console.log(`[crawler-link] 链接页面录制完成`);
        });
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
      }
    });
    return;
  }

  // 新的生成爬虫脚本 API（支持多区域选择 + 确认弹窗后调用）
  if (pathname === '/api/crawler/generate') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, message: '方法不允许' });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const scriptName = normalizeScriptName(payload.scriptName || payload.name || 'new_crawler');
        const targetUrl = normalizeCrawlerTargetUrl(payload.targetUrl || '');
        const selections = payload.selections || [];
        const linkSelections = payload.linkSelections || [];
        const headless = Boolean(payload.headless);
        const browser = payload.browser || 'msedge';
        const clickMode = payload.clickMode || 'click';
        const waitAfterClick = parseFloat(payload.waitAfterClick) || 2;
        const userAgent = payload.userAgent || '';
        const extraArgs = payload.extraArgs || '';
        const followLink = Boolean(payload.followLink);
        const autoGenerate = payload.autoGenerate !== false;

        if (!targetUrl) {
          sendJson(res, 400, { success: false, message: '请先填写目标网址' });
          return;
        }
        if (selections.length === 0) {
          sendJson(res, 400, { success: false, message: '请先录制至少一个区域' });
          return;
        }

        // 保存 meta 信息
        const meta = ensureMeta(scriptName);
        meta.scriptType = 'crawler_selector';
        meta.targetUrl = targetUrl;
        meta.headless = headless;
        meta.browser = browser;
        meta.clickMode = clickMode;
        meta.waitAfterClick = waitAfterClick;
        meta.userAgent = userAgent;
        meta.extraArgs = extraArgs;
        meta.followLink = followLink;
        meta.updatedAt = new Date().toISOString();
        saveState();

        if (!autoGenerate) {
          // 如果不自动生成，只保存参数和选择数据
          const selectionConfigPath = `${path.basename(scriptName, '.py')}_selection.json`;
          const selOutputPath = path.join(scriptsDir, selectionConfigPath);
          fs.writeFileSync(selOutputPath, JSON.stringify({
            target_url: targetUrl,
            selections: selections,
            selection_count: selections.length,
            timestamp: new Date().toISOString()
          }, null, 2), 'utf8');
          sendJson(res, 200, { success: true, message: '参数已保存，未生成脚本', name: scriptName });
          return;
        }

        // 生成多区域爬虫脚本
        const generatedContent = buildMultiSelectionScript(
          scriptName, targetUrl, selections,
          { browser, clickMode, waitAfterClick, userAgent, headless, followLink, linkSelections }
        );
        const filePath = getScriptPath(scriptName);
        fs.writeFileSync(filePath, generatedContent, 'utf8');

        // 同时保存选择数据到 selection JSON
        const selectionConfigPath = `${path.basename(scriptName, '.py')}_selection.json`;
        const selOutputPath = path.join(scriptsDir, selectionConfigPath);
        fs.writeFileSync(selOutputPath, JSON.stringify({
          target_url: targetUrl,
          selections: selections,
          selection_count: selections.length,
          timestamp: new Date().toISOString()
        }, null, 2), 'utf8');

        console.log(`[crawler] 多区域爬虫脚本已生成: ${scriptName} (${selections.length} 个区域)`);
        sendJson(res, 200, { success: true, message: `爬虫脚本已生成（${selections.length} 个区域）`, name: scriptName });
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
      }
    });
    return;
  }

  // 特殊处理：读取 selection JSON 文件（用于前端轮询录制结果）
  if (pathname === '/api/selection-json') {
    const name = url.searchParams.get('name');
    if (!name) {
      sendJson(res, 400, { success: false, message: '缺少文件名' });
      return;
    }
    const safeName = path.basename(name.replace(/\.\./g, ''));
    const filePath = path.join(scriptsDir, safeName);
    if (!fs.existsSync(filePath)) {
      sendJson(res, 200, { success: true, content: null });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      sendJson(res, 200, { success: true, content });
    } catch (err) {
      sendJson(res, 200, { success: true, content: null });
    }
    return;
  }

  if (pathname.startsWith('/api/scripts/')) {
    const segments = pathname.split('/').filter(Boolean);
    const scriptName = segments[2];
    const action = segments[3];

    if (!scriptName) {
      sendJson(res, 400, { success: false, message: '缺少脚本名' });
      return;
    }

    const decodedName = decodeURIComponent(scriptName);

    if (req.method === 'GET') {
      const content = readScriptContent(decodedName);
      const meta = ensureMeta(decodedName);
      sendJson(res, 200, {
        name: decodedName,
        content,
        scheduleValue: Number(meta.scheduleValue) || 0,
        scheduleUnit: meta.scheduleUnit || 'minute',
        scheduleMinutes: Number(meta.scheduleMinutes) || 0,
        startTime: meta.startTime || '',
        endTime: meta.endTime || '',
        runMode: meta.runMode || 'continuous',
        maxRuns: Number(meta.maxRuns) || 0,
        status: activeProcesses.has(decodedName) ? '运行中' : meta.status || '未启动',
        lastOutput: meta.lastOutput || '',
        lastStartedAt: meta.lastStartedAt || '',
        lastStoppedAt: meta.lastStoppedAt || '',
        lastExitCode: meta.lastExitCode || null,
        scriptType: meta.scriptType || 'normal',
        headless: meta.headless === true,
        browser: meta.browser || 'msedge',
        clickMode: meta.clickMode || 'click',
        waitAfterClick: Number(meta.waitAfterClick) || 2,
        userAgent: meta.userAgent || '',
        extraArgs: meta.extraArgs || '',
        followLink: meta.followLink === true
      });
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const newName = normalizeScriptName(decodedName);

          // 保护：禁止修改辅助脚本
          if (HELPER_SCRIPTS.has(newName)) {
            sendJson(res, 403, { success: false, message: '禁止修改系统辅助脚本' });
            return;
          }

          // 保护：拒绝保存空内容，防止误操作清空脚本文件
          if (!payload.content || !payload.content.trim()) {
            sendJson(res, 400, { success: false, message: '脚本内容不能为空，拒绝保存' });
            return;
          }

          writeScriptContent(newName, payload.content);
          const meta = ensureMeta(newName);
          meta.scheduleValue = Number(payload.scheduleValue) || Number(payload.scheduleMinutes) || 0;
          meta.scheduleUnit = payload.scheduleUnit || 'minute';
          meta.scheduleMinutes = meta.scheduleUnit === 'hour' ? meta.scheduleValue * 60 : meta.scheduleValue;
          meta.startTime = payload.startTime || '';
          meta.endTime = payload.endTime || '';
          meta.runMode = payload.runMode || 'continuous';
          meta.maxRuns = Number(payload.maxRuns) || 0;
          // 保存爬虫参数（如果提供了）
          if (payload.targetUrl !== undefined) {
            meta.targetUrl = payload.targetUrl;
            meta.scriptType = 'crawler_selector';
          }
          if (payload.headless !== undefined) {
            meta.headless = Boolean(payload.headless);
          }
          if (payload.browser !== undefined) {
            meta.browser = payload.browser;
          }
          if (payload.clickMode !== undefined) {
            meta.clickMode = payload.clickMode;
          }
          if (payload.waitAfterClick !== undefined) {
            meta.waitAfterClick = Number(payload.waitAfterClick);
          }
          if (payload.followLink !== undefined) {
            meta.followLink = Boolean(payload.followLink);
          }
          meta.updatedAt = new Date().toISOString();
          saveState();
          sendJson(res, 200, { success: true, message: '脚本已保存', name: newName });
        } catch (error) {
          sendJson(res, 400, { success: false, message: error.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && action === 'start') {
      sendJson(res, 200, startScript(decodedName));
      return;
    }

    if (req.method === 'POST' && action === 'stop') {
      sendJson(res, 200, stopScript(decodedName));
      return;
    }

    if (req.method === 'POST' && action === 'open-dir') {
      const dataDir = getScriptDataDir(decodedName);
      // 确保目录存在
      fs.mkdirSync(dataDir, { recursive: true });
      // 在文件管理器中打开（explorer 在 Windows 上即使成功也可能触发 error，故不依赖回调）
      const { exec } = require('child_process');
      exec(`explorer "${dataDir}"`);
      sendJson(res, 200, { success: true, message: '已打开数据目录', dir: dataDir });
      return;
    }

    if (req.method === 'DELETE') {
      sendJson(res, 200, deleteScript(decodedName));
      return;
    }
  }

  // 获取脚本最新生成结果 API
  if (pathname === '/api/scripts-latest-result') {
    const name = url.searchParams.get('name');
    if (!name) {
      sendJson(res, 400, { success: false, message: '缺少脚本名' });
      return;
    }
    const safeName = normalizeScriptName(name);
    const dataDir = getScriptDataDir(safeName);
    if (!fs.existsSync(dataDir)) {
      sendJson(res, 200, { success: true, hasResult: false, message: '尚无数据目录' });
      return;
    }
    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) {
      sendJson(res, 200, { success: true, hasResult: false, message: '尚无结果文件' });
      return;
    }
    try {
      const latestFile = files[0];
      const content = fs.readFileSync(path.join(dataDir, latestFile), 'utf8');
      const parsed = JSON.parse(content);
      sendJson(res, 200, {
        success: true,
        hasResult: true,
        fileName: latestFile,
        result: parsed
      });
    } catch (err) {
      sendJson(res, 200, { success: true, hasResult: false, message: `读取结果失败: ${err.message}` });
    }
    return;
  }

  // 数据目录信息 API
  if (pathname === '/api/scripts-data-dir') {
    const name = url.searchParams.get('name');
    if (!name) {
      sendJson(res, 400, { success: false, message: '缺少脚本名' });
      return;
    }
    const safeName = normalizeScriptName(name);
    const dataDir = getScriptDataDir(safeName);
    const exists = fs.existsSync(dataDir);
    let files = [];
    if (exists) {
      files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    }
    sendJson(res, 200, { success: true, dir: dataDir, exists, files });
    return;
  }

  const filePath = pathname === '/' ? path.join(rootDir, 'index.html') : path.join(rootDir, pathname);
  serveStatic(res, filePath);
});

server.listen(port, () => {
  console.log(`Python dashboard server is running at http://127.0.0.1:${port}`);
});
