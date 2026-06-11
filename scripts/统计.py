import json
import os
import time
import random
from datetime import datetime
from playwright.sync_api import sync_playwright

# ===== 多区域选择参数（由区域选择工具生成） =====
TARGET_URL = "https://stats.gd.gov.cn/gdtjnj/index.html"
SELECTIONS = [
    {
        "tagName": "a",
        "id": "",
        "className": "news-link",
        "text": "广东统计年鉴2025年",
        "href": "http://stats.gd.gov.cn/gdtjnj/content/post_4810393.html",
        "cssSelector": "main.main-content > div.container > div.content-wrapper:nth-of-type(2) > div.news-list-container > ul.overview-news-list > li.news-item:nth-of-type(1) > a.news-link",
        "xpath": "/html/body[1]/main[1]/div[1]/div[2]/div[1]/ul[1]/li[1]/a[1]",
        "x": 41,
        "y": 525,
        "width": 1100,
        "height": 24
    }
]

# 浏览器设置
BROWSER = "msedge"
HEADLESS = True
CLICK_MODE = "click"
WAIT_AFTER_CLICK = 2
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0"
FOLLOW_LINK = False
LINK_SELECTIONS = [
    {
        "tagName": "div",
        "id": "",
        "className": "article-content",
        "text": "查阅方式：①在线浏览 ②文件下载（2025广东统计年鉴光盘内容.zip）",
        "href": "",
        "cssSelector": "main.main-content > div.container > div.article-container:nth-of-type(2) > div.article-content:nth-of-type(2)",
        "xpath": "/html/body[1]/main[1]/div[1]/div[2]/div[2]",
        "x": 30,
        "y": 580,
        "width": 1205,
        "height": 137
    }
]

# ===== 数据保存配置 =====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, os.path.splitext(os.path.basename(__file__))[0])


def ensure_data_dir():
    """创建脚本专属数据目录"""
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f'📁 数据目录: {DATA_DIR}')


def save_result(data, filename=None):
    """保存提取的数据到脚本专属目录"""
    ensure_data_dir()
    if filename is None:
        filename = f'result_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    filepath = os.path.join(DATA_DIR, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'💾 数据已保存: {filepath}')
    return filepath


def random_delay(min_sec=1.5, max_sec=4.0, reason=""):
    """反爬随机延迟 - 在操作之间添加随机延时，模拟人类行为"""
    delay = random.uniform(min_sec, max_sec)
    reason_text = f" ({reason})" if reason else ""
    print(f'⏳ 随机延迟 {delay:.1f} 秒{reason_text}...')
    time.sleep(delay)


def extract_article_content(page):
    """智能提取页面中的文章/新闻主要内容，而不是整个页面"""
    result = {'title': '', 'content': '', 'source': '', 'date': '', 'content_length': 0}

    # 获取页面标题
    try:
        result['title'] = page.title()
    except Exception:
        pass

    # 从 meta 标签获取信息
    try:
        metas = page.query_selector_all('meta')
        for meta in metas:
            name = (meta.get_attribute('name') or '').lower()
            prop = (meta.get_attribute('property') or '').lower()
            content = meta.get_attribute('content') or ''
            if name == 'source' or prop == 'article:source':
                result['source'] = content
            if name == 'pubdate' or name == 'publishdate' or prop == 'article:published_time':
                result['date'] = content
    except Exception:
        pass

    # 按优先级尝试各种内容选择器
    content_selectors = [
        '.pages_content', '.article_content', '.content',
        '#UCAP-CONTENT', '.news_content', '.main-content',
        'article', '.text-content',
        '.article', '.article-box', '.news-text', '.detail-content',
        '.detail-text', '.main-text', '#content', '#article',
        '.post-content', '.entry-content',
        '.table-content', 'table',
    ]

    best_text = ''
    best_len = 0
    for selector in content_selectors:
        try:
            elements = page.query_selector_all(selector)
            for el in elements:
                text = el.inner_text().strip()
                if len(text) > 50 and len(text) > best_len:
                    best_text = text
                    best_len = len(text)
        except Exception:
            pass

    if best_text:
        result['content'] = best_text
        result['content_length'] = len(best_text)
        return result

    # 兜底：查找页面中最大的文本块
    try:
        block_tags = ['div', 'p', 'section', 'main', 'td']
        for tag in block_tags:
            elements = page.query_selector_all(tag)
            for el in elements:
                text = el.inner_text().strip()
                if 100 < len(text) < 50000 and len(text) > best_len:
                    inner_html = (el.inner_html() or '').lower()
                    if any(skip in inner_html for skip in ['nav', 'footer', 'header', 'menu']):
                        continue
                    best_text = text
                    best_len = len(text)
    except Exception:
        pass

    if best_text:
        result['content'] = best_text
        result['content_length'] = len(best_text)
    else:
        try:
            body = page.query_selector('body')
            if body:
                text = body.inner_text().strip()
                result['content'] = text[:5000]
                result['content_length'] = len(text)
        except Exception:
            pass
    return result


def extract_page_content(page):
    """提取当前页面的主要内容（使用智能提取，只获取需要的内容）"""
    result = extract_article_content(page)
    return result['content']


def main():
    print(f'🎯 目标网址: {TARGET_URL}')
    print(f'📋 已选区域: {len(SELECTIONS)} 个')
    for i, sel in enumerate(SELECTIONS):
        print(f'  区域 #{i + 1}: <{sel.get("tagName", "?")}> {(sel.get("text") or "").strip()[:40]}')
    print(f'🌐 浏览器: {BROWSER}')
    print(f'{"📄 跟随链接: 是" if FOLLOW_LINK else ""}')
    print(f'📁 数据目录: {DATA_DIR}')
    print('---')

    ensure_data_dir()

    edge_user_data_dir = os.path.join(SCRIPT_DIR, '.crawler_user_data')
    with sync_playwright() as p:
        browser_inst = p.chromium.launch_persistent_context(
            user_data_dir=edge_user_data_dir,
            channel=BROWSER,
            headless=HEADLESS,
            viewport=None,
            args=[
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized',
                '--disable-popup-blocking'
            ],
            user_agent=USER_AGENT
        )
        page = browser_inst.new_page()
        page.goto(TARGET_URL, wait_until='domcontentloaded', timeout=60000)
        random_delay(1.0, 2.5, "等待页面初始加载")

        # 依次点击所有选择的区域
        all_results = []
        for i, sel in enumerate(SELECTIONS):
            cx = sel['x'] + sel['width'] / 2
            cy = sel['y'] + sel['height'] / 2
            css_sel = sel.get('cssSelector', '')
            xpath = sel.get('xpath', '')
            clicked_text = ''
            clicked_href = ''
            followed_article = {}

            print(f'\n{"="*40}')
            print(f'📌 区域 #{i + 1}: <{sel.get("tagName", "?")}> {(sel.get("text") or "").strip()[:40]}')
            print(f'  坐标: ({int(cx)}, {int(cy)})')
            print(f'  CSS: {css_sel}')

            # 反爬随机延迟 - 每个链接操作前随机等待
            random_delay(1.5, 4.0, f"准备操作区域 #{i + 1}")

            # 通过坐标点击
            page.mouse.click(int(cx), int(cy))
            time.sleep(WAIT_AFTER_CLICK)

            # 通过 CSS 选择器点击
            if css_sel and css_sel != 'body':
                try:
                    el = page.query_selector(css_sel)
                    if el:
                        el.click()
                        time.sleep(WAIT_AFTER_CLICK)
                        clicked_text = el.inner_text().strip()
                        clicked_href = el.get_attribute('href') or ''
                        print(f'  📝 文本: {clicked_text[:60]}')
                        if clicked_href:
                            print(f'  🔗 链接: {clicked_href}')
                except Exception:
                    pass

            # 如果启用了跟随链接，进入链接页面获取内容并记录
            if FOLLOW_LINK and clicked_href:
                if clicked_href.startswith('http'):
                    link_url = clicked_href
                elif clicked_href.startswith('/'):
                    from urllib.parse import urlparse
                    parsed = urlparse(TARGET_URL)
                    link_url = f'{parsed.scheme}://{parsed.netloc}{clicked_href}'
                else:
                    link_url = clicked_href
                print(f'  🔗 跟随链接: {link_url}')
                try:
                    random_delay(2.0, 4.0, f"打开链接 #{i + 1}")
                    page.goto(link_url, wait_until='domcontentloaded', timeout=30000)
                    random_delay(1.0, 2.5, "等待链接页面加载")

                    # 提取链接页面内容 - 根据是否有自定义区域选择决定方式
                    link_content_parts = []
                    if LINK_SELECTIONS:
                        # 使用自定义区域选择提取特定区域
                        print(f'  📋 使用自定义区域选择 ({len(LINK_SELECTIONS)} 个)')
                        for li, link_sel in enumerate(LINK_SELECTIONS):
                            lx_css = link_sel.get('cssSelector', '')
                            if lx_css:
                                try:
                                    link_el = page.query_selector(lx_css)
                                    if link_el:
                                        link_region_text = link_el.inner_text().strip()
                                        link_region_html = link_el.inner_html()
                                        link_content_parts.append({
                                            'region_index': li + 1,
                                            'tag_name': link_sel.get('tagName', ''),
                                            'css_selector': lx_css,
                                            'text': link_region_text[:200],
                                            'html_length': len(link_region_html)
                                        })
                                        print(f'    ✅ 链接页面区域 #{li + 1}: {link_region_text[:60]}')
                                except Exception as ex:
                                    print(f'    ⚠️ 链接页面区域 #{li + 1} 提取失败: {ex}')
                        followed_article = {
                            'title': page.title(),
                            'content': json.dumps(link_content_parts, ensure_ascii=False),
                            'content_length': len(json.dumps(link_content_parts)),
                            'source': '',
                            'date': '',
                            'regions': link_content_parts,
                            'extraction_mode': 'custom_regions'
                        }
                        print(f'  ✅ 已提取链接页面 {len(link_content_parts)} 个自定义区域')
                    else:
                        # 默认提取整个网页内容
                        followed_article = extract_article_content(page)
                        followed_article['extraction_mode'] = 'full_page'
                        print(f'  ✅ 已获取链接页面全文: {followed_article["title"]} ({followed_article["content_length"]} 字符)')
                        if followed_article.get('date'):
                            print(f'  📅 日期: {followed_article["date"]}')

                    # 返回原页面继续操作
                    random_delay(2.0, 4.0, "返回列表页")
                    page.goto(TARGET_URL, wait_until='domcontentloaded', timeout=30000)
                    random_delay(1.0, 2.0, "等待列表页加载")
                except Exception as e:
                    print(f'  ⚠️ 跟随链接失败: {e}')

            all_results.append({
                'index': i + 1,
                'tag_name': sel.get('tagName', ''),
                'css_selector': css_sel,
                'xpath': xpath,
                'text': clicked_text,
                'href': clicked_href,
                'coordinates': {'x': int(cx), 'y': int(cy)},
                'followed_content': followed_article.get('content', '') if FOLLOW_LINK else '',
                'followed_title': followed_article.get('title', '') if FOLLOW_LINK else '',
                'followed_article': followed_article if FOLLOW_LINK else {}
            })

        # 提取页面数据（使用智能提取，只获取需要的内容）
        print(f'\n{"="*40}')
        print('📄 正在提取页面数据...')
        page_article = extract_article_content(page)
        page_content = page_article['content']
        page_title = page_article['title'] or page.title()

        # 记录链接页面提取模式
        link_extraction_mode = 'custom_regions' if LINK_SELECTIONS else ('full_page' if FOLLOW_LINK else 'none')

        result_data = {
            'target_url': TARGET_URL,
            'page_title': page_title,
            'selection_count': len(SELECTIONS),
            'selections': all_results,
            'page_content': page_content,
            'page_content_length': len(page_content),
            'follow_link_enabled': FOLLOW_LINK,
            'link_extraction_mode': link_extraction_mode,
            'link_selection_count': len(LINK_SELECTIONS),
            'timestamp': datetime.now().isoformat()
        }

        save_result(result_data)
        browser_inst.close()
    print(f'\n✅ 执行完成，共处理 {len(SELECTIONS)} 个区域')


if __name__ == '__main__':
    main()
