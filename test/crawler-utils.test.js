const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGeneratedCrawlerScript, normalizeCrawlerTargetUrl } = require('../crawler-utils');

test('buildGeneratedCrawlerScript without selection data generates template', () => {
  const script = buildGeneratedCrawlerScript('demo_crawler', 'https://example.com', 'demo_crawler_selection.json');
  assert.match(script, /TARGET_URL = "https:\/\/example.com"/);
  assert.match(script, /CONFIG_PATH = .*demo_crawler_selection.json/);
  assert.match(script, /playwright.sync_api/);
  assert.match(script, /未找到区域选择参数/);
});

test('buildGeneratedCrawlerScript with selection data embeds coordinates', () => {
  const selectionData = {
    selection: {
      tag: 'div',
      cssSelector: '#main > div.content',
      xpath: '/html/body/div[1]/div[2]',
      x: 100, y: 200, width: 800, height: 600,
      text: '示例内容'
    }
  };
  const script = buildGeneratedCrawlerScript('demo_crawler', 'https://example.com', 'demo_crawler_selection.json', selectionData);
  assert.match(script, /TARGET_URL = "https:\/\/example.com"/);
  assert.match(script, /CENTER_X = 500/);  // 100 + 800/2
  assert.match(script, /CENTER_Y = 500/);  // 200 + 600/2
  assert.match(script, /CSS_SELECTOR = '#main > div.content'/);
  assert.match(script, /XPATH = '\/html\/body\[1\]\/div\[2\]\/div\[2\]'/);
  assert.match(script, /playwright.sync_api/);
});

test('normalizeCrawlerTargetUrl trims whitespace and adds https scheme', () => {
  assert.equal(normalizeCrawlerTargetUrl('  www.example.com  '), 'https://www.example.com');
  assert.equal(normalizeCrawlerTargetUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeCrawlerTargetUrl(''), '');
});

test('browser recorder helper script exists', () => {
  const helperScriptPath = path.join(__dirname, '..', 'scripts', '网页区域选择爬虫.py');
  assert.equal(fs.existsSync(helperScriptPath), true);
});
