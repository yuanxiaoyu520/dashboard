# Dashboard — 仪表盘

一个功能完整的网页爬虫管理与自动化脚本执行仪表盘，支持可视化区域选择、多链接爬取、反爬策略集成与定时任务调度。

## 功能特性

- **脚本管理** — 查看、编辑、运行、停止、定时执行、删除 Python 脚本
- **可视化爬虫** — 通过浏览器点击选定网页区域，自动生成 CSS/XPath 选择器
- **多区域录制** — Ctrl+Click 多选页面元素，支持嵌套链接页面区域选择
- **脚本自动生成** — 录制区域后一键生成可独立运行的 Python 爬虫脚本
- **反爬策略** — 内置随机延迟、模拟人类滚动、智能内容提取等反爬模块
- **定时调度** — 为脚本设置定时执行间隔，自动循环采集
- **数据看板** — 实时查看脚本运行状态与采集结果

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
node server.js

# 3. 打开浏览器访问
http://127.0.0.1:3000/
```

## 项目结构

```
stock-quant-dashboard/
├── app.js                  # 前端交互逻辑
├── crawler-setup.html      # 爬虫可视化配置界面（区域录制、脚本生成）
├── crawler-utils.js        # 爬虫脚本生成工具（buildMultiSelectionScript）
├── index.html              # 仪表盘主页
├── server.js               # 后端服务（API、脚本管理、WebSocket）
├── styles.css              # 页面样式
├── start-dashboard.bat     # Windows 一键启动脚本
├── VERSION.txt             # 版本号
├── .gitignore
├── README.md
├── data/                   # 运行时数据（脚本状态等）
├── scripts/                # Python 爬虫脚本目录
│   ├── 网页区域选择爬虫.py  # 交互式区域选择器（核心工具）
│   ├── crawler_utils.py    # 共享工具模块（反爬延迟、内容提取等）
│   ├── 伦敦金.py           # 示例：伦敦金数据采集
│   ├── 上海黄金交易.py      # 示例：上海黄金交易所数据采集
│   ├── 统计.py             # 示例：统计数据采集
│   ├── 陈店政策.py          # 示例：政策信息采集（多链接）
│   ├── 政策搜索结果页_中国政府网.py  # 示例：政府网站搜索采集
│   └── *_selection.json    # 区域选择配置文件（由录制生成）
└── test/                   # 测试文件
    └── crawler-utils.test.js
```

## 版本历史

| 版本 | 说明 |
|------|------|
| 3.0 | 稳定版 — 完整爬虫链路、反爬策略、链接区域选择、定时调度 |
| 2.0 | 多区域录制、脚本自动生成链路打通 |
| 1.3 | 基础爬虫功能、单区域选择、脚本管理仪表盘 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS
- **爬虫**: Python + Playwright
- **通信**: REST API + WebSocket
