"""
网页区域选择爬虫 - 交互式区域选择辅助脚本

功能：
  1. 启动本地 Edge 浏览器并打开目标网址
  2. 在页面中注入 JS 辅助函数，支持鼠标悬停高亮、点击选择区域
  3. 用户点击目标区域后，自动提取 CSS Selector、XPath、坐标等信息
  4. 将选择结果保存为 JSON 文件，供主程序生成最终爬虫脚本

用法：
  py -3 -u -X utf8 "网页区域选择爬虫.py" --url https://example.com --output selection.json
  py -3 -u -X utf8 "网页区域选择爬虫.py" --url https://example.com --output selection.json --browser chrome --headless
"""

import argparse
import json
import os
import sys
import time
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)-8s | %(name)s:%(lineno)d - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger(__name__)

JS_HELPERS = """
// 获取元素的 CSS 选择器
function getCssSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);

    const path = [];
    while (el && el !== document.body && el !== document.documentElement) {
        let selector = el.tagName.toLowerCase();
        if (el.id) {
            path.unshift('#' + CSS.escape(el.id));
            break;
        }
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\\s+/).filter(Boolean);
            if (classes.length > 0) {
                selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            }
        }
        const parent = el.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                child => child.tagName === el.tagName
            );
            if (siblings.length > 1) {
                const index = siblings.indexOf(el) + 1;
                selector += ':nth-of-type(' + index + ')';
            }
        }
        path.unshift(selector);
        el = el.parentElement;
    }
    return path.join(' > ');
}

// 获取元素的 XPath
function getXpath(el) {
    if (!el || el === document.body) return '/html/body';
    if (el === document.documentElement) return '/html';

    const path = [];
    while (el && el !== document.documentElement) {
        let index = 1;
        let sibling = el.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === el.tagName) index++;
            sibling = sibling.previousElementSibling;
        }
        const tagName = el.tagName.toLowerCase();
        path.unshift(tagName + '[' + index + ']');
        el = el.parentElement;
    }
    return '/html/' + path.join('/');
}

// 高亮显示元素（悬停时临时高亮）
function highlightElement(el) {
    removeHighlight();
    if (!el) return;
    const overlay = document.createElement('div');
    overlay.id = '__crawler_highlight__';
    const rect = el.getBoundingClientRect();
    overlay.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid #ff4444;
        background: rgba(255, 68, 68, 0.1);
        pointer-events: none;
        z-index: 2147483647;
        box-sizing: border-box;
        transition: all 0.15s ease;
    `;
    document.body.appendChild(overlay);
}

// 移除临时高亮
function removeHighlight() {
    const existing = document.getElementById('__crawler_highlight__');
    if (existing) existing.remove();
}

// 为已选择的元素添加锁定绿色框
function addLockedOverlay(el, index) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = '__crawler_locked__';
    overlay.dataset.index = index;
    overlay.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid #22c55e;
        background: rgba(34, 197, 94, 0.12);
        pointer-events: none;
        z-index: 2147483646;
        box-sizing: border-box;
    `;
    // 添加序号标签
    const label = document.createElement('div');
    label.style.cssText = `
        position: absolute;
        top: -20px;
        left: 0;
        background: #22c55e;
        color: white;
        font-size: 11px;
        font-weight: bold;
        padding: 1px 6px;
        border-radius: 3px;
        line-height: 16px;
    `;
    label.textContent = '#' + index;
    overlay.appendChild(label);
    document.body.appendChild(overlay);
}

// 刷新所有锁定框（页面滚动/缩放后重新定位）
function refreshLockedOverlays() {
    document.querySelectorAll('.__crawler_locked__').forEach(el => el.remove());
    const selections = window.__crawler_selections__ || [];
    selections.forEach((info, i) => {
        // 尝试通过 CSS 选择器重新找到元素
        try {
            const el = document.querySelector(info.cssSelector);
            if (el) {
                addLockedOverlay(el, i + 1);
            }
        } catch(e) {}
    });
}

// 获取元素信息
function getElementInfo(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || '',
        className: (el.className && typeof el.className === 'string') ? el.className : '',
        text: (el.textContent || '').trim().slice(0, 100),
        href: el.href || '',
        cssSelector: getCssSelector(el),
        xpath: getXpath(el),
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };
}
"""


class InteractiveSelectorCrawler:
    """交互式区域选择爬虫"""

    def __init__(self, target_url, output_path, headless=False, multi_select=False):
        self.target_url = target_url
        self.output_path = output_path
        self.headless = headless
        self.multi_select = multi_select
        self.browser = None
        self.context = None
        self.page = None
        self.selected_info = None
        self.all_selections = []

    def _build_js_helpers(self):
        """构建要注入的 JS 辅助代码"""
        return JS_HELPERS

    def _init_browser(self):
        """初始化 Playwright 并启动 Edge 浏览器"""
        from playwright.sync_api import sync_playwright

        self._playwright = sync_playwright().start()

        # 使用本地 Edge 用户数据目录，保持登录状态
        edge_user_data_dir = os.path.join(
            os.environ.get('LOCALAPPDATA', ''),
            'Microsoft', 'Edge', 'User Data', 'Default'
        )
        # 如果找不到默认目录，使用项目目录下的缓存
        if not os.path.exists(edge_user_data_dir):
            edge_user_data_dir = os.path.join(os.path.dirname(__file__), '.crawler_user_data')

        logger.info(f'📌 已启动本地 Edge 浏览器，目标网址：{self.target_url}')

        self.context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=edge_user_data_dir,
            channel='msedge',
            headless=self.headless,
            viewport=None,
            args=[
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized',
                '--disable-popup-blocking'
            ],
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0'
        )
        self.page = self.context.new_page()
        self.page.goto(self.target_url, wait_until='domcontentloaded', timeout=60000)
        time.sleep(2)

    def _inject_js(self):
        """向页面注入 JS 辅助函数"""
        js_code = self._build_js_helpers()
        self.page.evaluate(js_code)
        logger.info('✅ JS 辅助函数已注入')

    def _setup_event_listeners(self):
        """设置页面事件监听器（悬停高亮 + Ctrl+点击多选）"""
        setup_code = """
        // 当前悬停的元素
        let __hoveredEl = null;
        // 已选择的元素列表
        window.__crawler_selections__ = window.__crawler_selections__ || [];

        // 鼠标移动时高亮
        document.addEventListener('mousemove', function(e) {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el && el !== __hoveredEl) {
                __hoveredEl = el;
                highlightElement(el);
            }
        }, { passive: true });

        // 点击选择区域
        document.addEventListener('click', function(e) {
            // 阻止默认行为，防止页面跳转
            e.preventDefault();
            e.stopPropagation();

            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return;

            const info = getElementInfo(el);
            if (!info || !info.cssSelector) return;

            // 检查是否已选择过
            const existsIndex = window.__crawler_selections__.findIndex(s => s.cssSelector === info.cssSelector);

            if (e.ctrlKey || e.metaKey) {
                // Ctrl+Click: 添加新选择（如果已存在则取消选择）
                if (existsIndex >= 0) {
                    // 已存在，取消选择
                    window.__crawler_selections__.splice(existsIndex, 1);
                    refreshLockedOverlays();
                    console.log('❌ 取消选择:', info.cssSelector, '剩余', window.__crawler_selections__.length, '个');
                } else {
                    // 添加新选择
                    window.__crawler_selections__.push(info);
                    addLockedOverlay(el, window.__crawler_selections__.length);
                    console.log('✅ Ctrl+添加区域:', info.cssSelector, '共', window.__crawler_selections__.length, '个');
                }
            } else {
                // 普通点击：替换为当前选择（只保留这一个）
                window.__crawler_selections__ = [info];
                refreshLockedOverlays();
                console.log('✅ 选择区域:', info.cssSelector);
            }

            // 更新到 window 供 Python 读取
            window.__crawler_selected__ = info;
        }, { capture: true });

        // 页面滚动时刷新锁定框位置
        window.addEventListener('scroll', refreshLockedOverlays, { passive: true });
        window.addEventListener('resize', refreshLockedOverlays, { passive: true });
        """
        self.page.evaluate(setup_code)
        logger.info('🖲️ 事件监听器已设置')
        logger.info('  💡 操作提示：')
        logger.info('     - 点击元素：选择该元素（替换之前的选择）')
        logger.info('     - Ctrl+点击：添加/取消选择（多选模式）')
        logger.info('     - 已选择的元素会显示绿色锁定框和序号')
        logger.info('     - 在终端输入 done 并回车结束录制')

    def _wait_for_selection(self):
        """等待用户在页面上点击选择区域"""
        logger.info('⏳ 等待用户在页面上点击选择区域...')
        logger.info('  提示：在浏览器中点击目标区域选择，然后在终端输入 done 结束录制')
        max_wait = 600  # 最长等待10分钟
        last_count = 0
        save_interval = 5  # 每5秒保存一次中间结果供前端轮询

        for i in range(max_wait):
            # 检查终端是否有输入 done
            if self._check_stdin_done():
                logger.info('✅ 用户输入 done，结束录制')
                break

            if self.multi_select:
                # 多选模式：收集所有选择
                result = self.page.evaluate('window.__crawler_selections__ || []')
                if result and len(result) > 0:
                    self.all_selections = result
                    if len(result) != last_count:
                        logger.info(f'📋 当前已选择 {len(result)} 个区域')
                        last_count = len(result)
                        # 有新的选择时立即保存中间结果
                        self._save_intermediate(result)
            else:
                # 单选模式：等待第一次选择
                result = self.page.evaluate('window.__crawler_selected__ || null')
                if result and result.get('cssSelector'):
                    self.selected_info = result
                    logger.info(f'✅ 已获取选择区域: {result.get("cssSelector")}')
                    return True

            # 定期保存中间结果（即使没有新选择）
            if self.multi_select and i > 0 and i % save_interval == 0 and len(self.all_selections) > 0:
                self._save_intermediate(self.all_selections)

            time.sleep(1)

        if self.multi_select and len(self.all_selections) > 0:
            logger.info(f'✅ 录制结束，共选择 {len(self.all_selections)} 个区域')
            return True
        elif self.selected_info:
            return True

        logger.warning('⏰ 等待超时，未检测到区域选择')
        return False

    def _save_intermediate(self, selections):
        """保存中间结果供前端轮询"""
        output = {
            'target_url': self.target_url,
            'selections': selections,
            'selection_count': len(selections),
            'timestamp': datetime.now().isoformat(),
            'recording': True  # 标记仍在录制中
        }
        try:
            os.makedirs(os.path.dirname(self.output_path) or '.', exist_ok=True)
            with open(self.output_path, 'w', encoding='utf-8') as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _check_stdin_done(self):
        """检查标准输入是否有 done 命令（非阻塞）"""
        import sys
        try:
            if sys.platform == 'win32':
                import msvcrt
                # 收集所有可用输入
                input_buffer = ''
                while msvcrt.kbhit():
                    ch = msvcrt.getwche()
                    input_buffer += ch
                if input_buffer.strip().lower() == 'done':
                    return True
                # 如果输入了其他内容，回显到 stdout
                if input_buffer.strip():
                    sys.stdout.write(f'[输入] {input_buffer.strip()}')
                    sys.stdout.flush()
            else:
                import select
                import sys
                if select.select([sys.stdin], [], [], 0)[0]:
                    line = sys.stdin.readline().strip().lower()
                    if line == 'done':
                        return True
        except Exception:
            pass
        return False

    def _save_result(self, info):
        """将选择结果保存为 JSON 文件"""
        if self.multi_select and len(self.all_selections) > 0:
            output = {
                'target_url': self.target_url,
                'selections': self.all_selections,
                'selection_count': len(self.all_selections),
                'timestamp': datetime.now().isoformat(),
                'recording': False  # 录制已完成
            }
        else:
            output = {
                'target_url': self.target_url,
                'selection': info,
                'timestamp': datetime.now().isoformat(),
                'recording': False
            }
        os.makedirs(os.path.dirname(self.output_path) or '.', exist_ok=True)
        with open(self.output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        logger.info(f'💾 选择结果已保存到: {self.output_path}')

    def _cleanup(self):
        """清理资源"""
        try:
            if self.page:
                self.page.close()
        except Exception:
            pass
        try:
            if self.context:
                self.context.close()
        except Exception:
            pass
        try:
            if hasattr(self, '_playwright') and self._playwright:
                self._playwright.stop()
        except Exception:
            pass

    def run(self):
        """主运行流程"""
        try:
            self._init_browser()
            self._inject_js()
            self._setup_event_listeners()

            if self._wait_for_selection():
                if self.multi_select and len(self.all_selections) > 0:
                    self._save_result(None)
                else:
                    self._save_result(self.selected_info)
                time.sleep(2)
                logger.info('🎉 区域选择完成！可以关闭浏览器窗口了。')
            else:
                logger.error('❌ 未获取到区域选择信息')
                sys.exit(1)
        except Exception as e:
            logger.error(f'❌ 执行异常：{e}')
            raise
        finally:
            self._cleanup()


def main():
    parser = argparse.ArgumentParser(description='网页区域选择爬虫 - 交互式区域选择辅助脚本')
    parser.add_argument('--url', required=True, help='目标网址')
    parser.add_argument('--output', required=True, help='选择结果输出路径（JSON 文件）')
    parser.add_argument('--browser', default='msedge', choices=['msedge', 'chrome'], help='浏览器类型')
    parser.add_argument('--timeout', type=int, default=60, help='页面加载超时时间（秒）')
    parser.add_argument('--headless', action='store_true', help='无头模式')
    parser.add_argument('--click-mode', default='click', choices=['click', 'dblclick', 'hover'], help='点击方式')
    parser.add_argument('--wait-after-click', type=float, default=2.0, help='点击后等待时间（秒）')
    parser.add_argument('--user-agent', default='', help='自定义 User-Agent')
    parser.add_argument('--extra-args', default='', help='额外浏览器参数')
    parser.add_argument('--multi-select', action='store_true', help='多选模式（可多次点击选择多个区域）')

    args = parser.parse_args()

    crawler = InteractiveSelectorCrawler(
        target_url=args.url,
        output_path=args.output,
        headless=args.headless,
        multi_select=args.multi_select
    )
    crawler.run()


if __name__ == '__main__':
    main()
