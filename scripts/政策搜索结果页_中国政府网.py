import json
import os
import time
import random
from datetime import datetime
from playwright.sync_api import sync_playwright

# 导入共享工具函数
from crawler_utils import random_delay, extract_article_content

# ===== 录制区域参数（由区域选择工具生成） =====
TARGET_URL = "https://www.gov.cn/search/zhengce/?t=zhengce&q=&timetype=timeyz&mintime=&maxtime=&sort=score&sortType=1&searchfield=&pcodeJiguan=&childtype=&subchildtype=&tsbq=&pubtimeyear=&puborg=&pcodeYear=&pcodeNum=&filetype=&p=0&n=5&inpro=&sug_t=zhengce"
SELECTION = {
    "tagName": "li",
    "id": "",
    "className": "",
    "text": "中共中央办公厅、国务院办公厅印发《关于用好乡镇（街道）履行职责事项清单的具体措施》  2026-5-19",
    "href": "",
    "cssSelector": "#dys_middle_result_content_ID > ul.middle_result_con.show:nth-of-type(1) > li:nth-of-type(1)",
    "xpath": "/html/body[1]/div[3]/div[1]/div[3]/div[2]/div[1]/div[1]/ul[1]/li[1]",
    "x": 367,
    "y": 416,
    "width": 616,
    "height": 83
}

# 计算点击中心点
CENTER_X = 675
CENTER_Y = 458
CSS_SELECTOR = '#dys_middle_result_content_ID > ul.middle_result_con.show:nth-of-type(1) > li:nth-of-type(1)'
XPATH = '/html/body[1]/div[3]/div[1]/div[3]/div[2]/div[1]/div[1]/ul[1]/li[1]'

# 浏览器设置
BROWSER = "msedge"
CLICK_MODE = "click"
WAIT_AFTER_CLICK = 2
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0"

# ===== 数据保存配置 =====
# 脚本专属数据目录（与脚本同名的文件夹）
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


def extract_element_text(page, selector=None):
    """提取页面元素的文本内容"""
    if selector:
        el = page.query_selector(selector)
        if el:
            return el.inner_text().strip()
    return ''


def extract_page_content(page):
    """提取当前页面的主要内容（使用智能提取，只获取需要的内容）"""
    result = extract_article_content(page)
    return result['content']


def main():
    print(f'🎯 目标网址: {TARGET_URL}')
    print(f'📌 点击坐标: ({CENTER_X}, {CENTER_Y})')
    print(f'🔍 CSS选择器: {CSS_SELECTOR}')
    print(f'📍 XPath: {XPATH}')
    print(f'📐 区域大小: {SELECTION["width"]} × {SELECTION["height"]}')
    print(f'🌐 浏览器: {BROWSER}')
    print(f'🖱️ 点击方式: {CLICK_MODE}')
    print(f'📁 数据目录: {DATA_DIR}')
    print('---')

    # 确保数据目录存在
    ensure_data_dir()

    edge_user_data_dir = os.path.join(SCRIPT_DIR, '.crawler_user_data')
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            user_data_dir=edge_user_data_dir,
            channel=BROWSER,
            headless=True,
            viewport=None,
            args=[
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized',
                '--disable-popup-blocking'
            ],
            user_agent=USER_AGENT
        )
        page = browser.new_page()
        page.goto(TARGET_URL, wait_until='domcontentloaded', timeout=60000)
        random_delay(1.0, 2.5, "等待页面初始加载")

        # 方式1：通过坐标点击
        print(f'🖱️ {CLICK_MODE} 坐标 ({CENTER_X}, {CENTER_Y})')
        if CLICK_MODE == 'dblclick':
            page.mouse.dblclick(CENTER_X, CENTER_Y)
        elif CLICK_MODE == 'hover':
            page.mouse.move(CENTER_X, CENTER_Y)
        else:
            page.mouse.click(CENTER_X, CENTER_Y)
        random_delay(WAIT_AFTER_CLICK, WAIT_AFTER_CLICK + 1.0, "点击后等待")

        # 方式2：通过 CSS 选择器点击（如果可用）
        clicked_text = ''
        if CSS_SELECTOR and CSS_SELECTOR != 'body':
            try:
                el = page.query_selector(CSS_SELECTOR)
                if el:
                    print(f'🖱️ 通过CSS选择器{CLICK_MODE}: {CSS_SELECTOR}')
                    if CLICK_MODE == 'dblclick':
                        el.dblclick()
                    elif CLICK_MODE == 'hover':
                        el.hover()
                    else:
                        el.click()
                    random_delay(WAIT_AFTER_CLICK, WAIT_AFTER_CLICK + 1.0, "点击后等待")
                    clicked_text = el.inner_text().strip()
                    print(f'📝 点击元素文本: {clicked_text[:100]}')
            except Exception:
                pass

        # 提取页面数据（使用智能提取，只获取需要的内容）
        print('📄 正在提取页面数据...')
        page_article = extract_article_content(page)
        page_content = page_article['content']
        page_title = page_article['title'] or page.title()

        # 组装结果数据
        result_data = {
            'target_url': TARGET_URL,
            'page_title': page_title,
            'clicked_element': {
                'css_selector': CSS_SELECTOR,
                'xpath': XPATH,
                'text': clicked_text,
                'coordinates': {'x': CENTER_X, 'y': CENTER_Y}
            },
            'page_content': page_content,
            'page_content_length': len(page_content),
            'timestamp': datetime.now().isoformat()
        }

        # 保存结果
        save_result(result_data)

        browser.close()
    print('✅ 执行完成')


if __name__ == '__main__':
    main()
