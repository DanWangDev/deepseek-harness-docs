# DeepSeek Harness 白皮书（本地文档站）

仿照 Claude Code 逆向工程白皮书体例编写的 **DeepSeek Harness 架构白皮书**：从架构全景、核心循环、工具系统、上下文工程、安全模型到内部机制，共 **9 章 36 页 · 中英双语**，全部基于开源仓库源码与官方文档整理。

站点支持 Mintlify 风格的主题切换（**深色 / 浅色**）与语言切换（**中文 / English**），选择会记住在浏览器 `localStorage` 中。

## 目录结构

```text
deepseek-harness-docs/
├── index.html            # 站点首页（构建产物）
├── README.md             # 本文件
├── nav.json              # 站点导航配置（章节 → 页面，含中英标题）
├── assets/
│   └── style.css         # 全局样式（含深色主题）
├── scripts/
│   └── build.mjs         # 构建脚本（零依赖，Node 18+）
├── src/
│   ├── index.md          # 中文首页内容源
│   ├── index.en.md       # 英文首页内容源
│   └── docs/             # 中文源文档（36 篇，分章组织）
│       └── en/           # 英文源文档（36 篇，镜像同构）
└── site/                 # 构建产物：可直接部署的静态站点
    ├── index.html        # 中文站点（根路径，URL 不变）
    ├── en/               # 英文站点（site/en/...）
    └── assets/style.css
```

## 本地浏览（无需服务器）

直接双击打开 `site/index.html` 即可阅读——站点是**零依赖纯静态页**（无 CDN、无外部请求），`file://` 协议下完全可用。英文版在 `site/en/index.html`。

## 本地部署（任选一种）

### 方式一：Python 内置服务器

```sh
cd deepseek-harness-docs/site
python -m http.server 8000
# 浏览器访问 http://127.0.0.1:8000
```

### 方式二：Node 任意静态服务器

```sh
cd deepseek-harness-docs/site
npx serve .            # 或 npx http-server .
# 浏览器访问 http://127.0.0.1:3000
```

### 方式三：PowerShell（Windows，无额外依赖）

```powershell
cd deepseek-harness-docs\site
# 用 Python 或任意静态服务器；PowerShell 自身无内置静态服务器，
# 最省事的方式是方式一或方式二。
```

> 提示：直接双击 `site/index.html` 已经可以浏览；启动本地服务器仅用于更真实的部署形态（干净的 URL、MIME 类型）。

## 重新构建（修改文档后）

```sh
cd deepseek-harness-docs
node scripts/build.mjs          # 构建中英两个站点
node scripts/build.mjs zh       # 只构建中文
node scripts/build.mjs en       # 只构建英文
```

脚本读取 `nav.json` 与 `src/docs/**/*.md`（中文）、`src/docs/en/**/*.md`（英文），生成 `site/` 与 `site/en/` 下全部 HTML（含首页、侧边栏导航、上一页/下一页、主题切换与语言切换）。需要 Node 18+，无任何 npm 依赖。

## 修改指南

1. **加页面**：在 `src/docs/<章节>/`（中文）与 `src/docs/en/<章节>/`（英文）各建一份 Markdown，然后在 `nav.json` 对应章节的 `items` 数组追加 `{ "file": "<路径>", "title": "<中文标题>", "titleEn": "<英文标题>" }`，重新构建
2. **改内容**：直接编辑 `src/docs/**/*.md` 与 `src/docs/en/**/*.md`，重新构建；页面间的 Markdown 链接（`.md` 结尾）会在构建时自动转为相对 `.html`，中英两套结构镜像，链接目标保持一致
3. **换样式**：编辑 `assets/style.css`（含 `[data-theme="dark"]` 深色变量），重新构建会拷贝到 `site/assets/` 与 `site/en/assets/`
4. **部署**：提交并推送 `main` 分支，GitHub Actions 会自动把 `site/` 发布到 GitHub Pages（仓库 `.github/workflows/deploy-pages.yml`）

## 写作约定（参考源站点体例）

- 每页以 `> ` 引言块开头，一句话概括该页内容
- 大量使用对比表格、ASCII 流程图与源码级类型/事件名，术语与官方[术语表](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/glossary.zh.md)一致
- 所有机制描述以仓库源码为准（`packages/`、`docs/`）；项目处于 developer preview，个别细节可能随版本变化

## 许可

本文档内容基于 MIT 许可的开源仓库 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 整理，仅供学习与内部参考。
