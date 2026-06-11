import json
import os
import time
import random
from datetime import datetime
from playwright.sync_api import sync_playwright

# 导入共享工具函数
from crawler_utils import random_delay, random_delay_medium, random_delay_long, extract_article_content

# ===== 多区域选择参数（由区域选择工具生成） =====
TARGET_URL = "http://www.chaonan.gov.cn/stcncdzf/gkmlpt/index"
SELECTIONS = [
    {
        "tagName": "td",
        "id": "",
        "className": "first-td",
        "text": "张晓铿带队督导调研防汛工作",
        "href": "",
        "cssSelector": "#postList > table.table-content > tbody > tr:nth-of-type(1) > td.first-td:nth-of-type(1)",
        "xpath": "/html/body[1]/div[2]/div[4]/div[2]/div[2]/table[1]/tbody[1]/tr[1]/td[1]",
        "x": 341,
        "y": 707,
        "width": 477,
        "height": 41
    },
    {
        "tagName": "td",
        "id": "",
        "className": "",
        "text": "2026-06-10",
        "href": "",
        "cssSelector": "#postList > table.table-content > tbody > tr:nth-of-type(1) > td:nth-of-type(2)",
        "xpath": "/html/body[1]/div[2]/div[4]/div[2]/div[2]/table[1]/tbody[1]/tr[1]/td[2]",
        "x": 818,
        "y": 707,
        "width": 100,
        "height": 41
    },
    {
        "tagName": "td",
        "id": "",
        "className": "",
        "text": "2026-06-09",
        "href": "",
        "cssSelector": "#postList > table.table-content > tbody > tr:nth-of-type(1) > td:nth-of-type(3)",
        "xpath": "/html/body[1]/div[2]/div[4]/div[2]/div[2]/table[1]/tbody[1]/tr[1]/td[3]",
        "x": 918,
        "y": 707,
        "width": 100,
        "height": 41
    }
]

# 浏览器设置
BROWSER = "msedge"
HEADLESS = False
CLICK_MODE = "click"
WAIT_AFTER_CLICK = 2
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0"
FOLLOW_LINK = True

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
        time.sleep(2)

        # 依次点击所有选择的区域
        all_results = []
        for i, sel in enumerate(SELECTIONS):
            cx = sel['x'] + sel['width'] / 2
            cy = sel['y'] + sel['height'] / 2
            css_sel = sel.get('cssSelector', '')
            xpath = sel.get('xpath', '')
            clicked_text = ''
            clicked_href = ''

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

            # 如果启用了跟随链接，进入链接页面获取内容
            followed_content = ''
            followed_title = ''
            followed_article = {}
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
                    # 打开链接前随机延迟
                    random_delay_medium(f"打开链接 #{i + 1}")
                    page.goto(link_url, wait_until='domcontentloaded', timeout=30000)
                    random_delay(1.0, 2.5, "等待页面加载")
                    # 使用智能提取，只获取文章主要内容
                    followed_article = extract_article_content(page)
                    followed_content = followed_article['content']
                    followed_title = followed_article['title']
                    print(f'  ✅ 已获取链接页面内容 ({len(followed_content)} 字符)')
                    if followed_article.get('date'):
                        print(f'  📅 日期: {followed_article["date"]}')
                    # 返回原页面继续操作 - 加随机延迟
                    random_delay_medium(f"返回列表页")
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
                'followed_content': followed_content if FOLLOW_LINK else '',
                'followed_title': followed_title if FOLLOW_LINK else '',
                'followed_article': followed_article if FOLLOW_LINK else {}
            })

        # 提取页面数据（使用智能提取，只获取需要的内容）
        print(f'\n{"="*40}')
        print('📄 正在提取页面数据...')
        page_article = extract_article_content(page)
        page_content = page_article['content']
        page_title = page_article['title'] or page.title()

        result_data = {
            'target_url': TARGET_URL,
            'page_title': page_title,
            'selection_count': len(SELECTIONS),
            'selections': all_results,
            'page_content': page_content,
            'page_content_length': len(page_content),
            'timestamp': datetime.now().isoformat()
        }

        save_result(result_data)
        browser_inst.close()
    print(f'\n✅ 执行完成，共处理 {len(SELECTIONS)} 个区域')


if __name__ == '__main__':
    main()
