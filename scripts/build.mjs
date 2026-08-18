// DeepSeek Harness 文档站构建脚本（零依赖，Node 18+）
// 用法: node scripts/build.mjs
// 输入: src/docs/**/*.md (zh) + src/docs/en/**/*.md (en) + nav.json + src/index.md / src/index.en.md
// 输出: site/ (中文) + site/en/ (English)，含主题切换与语言切换
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'assets')

const nav = JSON.parse(readFileSync(join(ROOT, 'nav.json'), 'utf8'))
const flat = nav.flatMap(sec => sec.items.map(it => ({ ...it, section: sec.section, sectionEn: sec.sectionEn })))

// ---------- theme toggle ----------
const THEME_HEAD = `<script>try{var s=localStorage.getItem('dsh-theme');document.documentElement.setAttribute('data-theme',s||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));}catch(e){}</script>`
const THEME_BODY = `<script>(function(){var b=document.getElementById('theme-toggle');if(!b)return;var set=function(t){document.documentElement.setAttribute('data-theme',t);b.querySelector('.ico').textContent=t==='dark'?'☀':'☾';};set(document.documentElement.getAttribute('data-theme'));b.onclick=function(){var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';set(n);try{localStorage.setItem('dsh-theme',n);}catch(e){}};})();</script>`
const THEME_BTN = `<button type="button" id="theme-toggle" class="ctrl" title="Toggle theme"><span class="ico">☾</span></button>`

// ---------- language config ----------
const LANGS = {
  zh: {
    out: 'site',
    src: 'src/docs',
    indexSrc: 'src/index.md',
    htmlLang: 'zh-CN',
    titleSuffix: '— DeepSeek Harness 白皮书',
    brandSub: '插件化 Agent 架构白皮书',
    home: '首页',
    prev: '上一页',
    next: '下一页',
    footer: 'DeepSeek Harness 白皮书 · 基于仓库源码与文档整理 · 本地静态站点，无外部依赖',
    ctaStart: '开始阅读',
    ctaReadme: '本地部署说明',
    langLabel: 'English',
    otherLang: 'en',
  },
  en: {
    out: 'site/en',
    src: 'src/docs/en',
    indexSrc: 'src/index.en.md',
    htmlLang: 'en',
    titleSuffix: '— DeepSeek Harness Whitepaper',
    brandSub: 'A Plugin-Based Agent Architecture Whitepaper',
    home: 'Home',
    prev: 'Previous',
    next: 'Next',
    footer: 'DeepSeek Harness Whitepaper · Compiled from repository source and docs · Static site, no external dependencies',
    ctaStart: 'Start Reading',
    ctaReadme: 'Local Deployment Guide',
    langLabel: '中文',
    otherLang: 'zh',
  },
}

const titleOf = (it, lang) => lang === 'zh' ? it.title : (it.titleEn || it.title)
const sectionOf = (sec, lang) => lang === 'zh' ? sec.section : (sec.sectionEn || sec.section)

// ---------- inline markdown ----------
const esc = s => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const linkify = (file, raw, outRoot) => raw.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (m, text, href) => {
  const h = href.trim()
  if (/^https?:\/\//.test(h) || h.startsWith('#')) return `<a href="${h}">${text}</a>`
  let target = h
  if (target.endsWith('.md')) target = target.replace(/\.md$/, '.html')
  // resolve relative to the current page's directory within src/docs
  const baseDir = dirname(file).replaceAll(sep, '/')
  if (!target.startsWith('/')) target = join(baseDir, target).replaceAll(sep, '/')
  // emit a href relative to THIS page's output location (site mirrors src/docs)
  const pageOut = join(outRoot, file.replace(/\.md$/, '.html'))
  target = rel(pageOut, join(outRoot, target))
  return `<a href="${target}">${text}</a>`
})

function inline(file, s, outRoot) {
  let out = esc(s)
  out = out.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (m, alt, src) => {
    const s2 = src.trim()
    if (/^https?:\/\//.test(s2)) return `<img src="${s2}" alt="${alt}" loading="lazy"/>`
    const baseDir = dirname(file).replaceAll(sep, '/')
    const target = join(baseDir, s2).replaceAll(sep, '/')
    const pageOut = join(outRoot, file.replace(/\.md$/, '.html'))
    return `<img src="${rel(pageOut, join(outRoot, target))}" alt="${alt}" loading="lazy"/>`
  })
  // trailing backslash = hard line break (reference-site style)
  out = out.replace(/\\\\\s*$/gm, '<br/>\n')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = linkify(file, out, outRoot)
  return out
}

// ---------- tables ----------
function splitCells(row) {
  let r = row.trim()
  if (r.startsWith('|')) r = r.slice(1)
  if (r.endsWith('|')) r = r.slice(0, -1)
  const cells = []
  let cur = ''
  let inCode = false
  for (const ch of r) {
    if (ch === '`') { inCode = !inCode; cur += ch; continue }
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function parseTable(file, rows, outRoot) {
  const cells = rows.map(splitCells)
  if (cells.length < 2) return null
  const head = cells[0]
  let body = cells.slice(2)
  // drop separator row (---)
  if (cells[1] && cells[1].every(c => /^:?-{1,}:?$/.test(c))) { /* separator ok */ } else { body = cells.slice(1) }
  const trs = body.map(r => {
    const tds = head.map((_, i) => `<td>${inline(file, r[i] ?? '', outRoot)}</td>`).join('')
    return `<tr>${tds}</tr>`
  })
  return `<table><thead><tr>${head.map(h => `<th>${inline(file, h, outRoot)}</th>`).join('')}</tr></thead><tbody>${trs.join('')}</tbody></table>`
}

// ---------- block parsing ----------
function render(file, md, outRoot) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // fenced code
    const fence = /^```(\S*)\s*$/.exec(line)
    if (fence) {
      const lang = fence[1]
      const buf = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // skip closing fence
      out.push(`<pre><code class="language-${esc(lang || 'text')}">${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      out.push(`<h${lvl}>${inline(file, h[2], outRoot)}</h${lvl}>`)
      i++
      continue
    }

    // hr
    if (/^(\s*)(-{3,}|\*{3,})\s*$/.test(line) && !/^\s*-/.test(line)) { out.push('<hr/>'); i++; continue }

    // table: gather consecutive pipe rows
    if (line.trim().startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++ }
      const t = parseTable(file, rows, outRoot)
      out.push(t ?? `<p>${inline(file, rows.join('<br/>'), outRoot)}</p>`)
      continue
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${render(file, buf.join('\n'), outRoot)}</blockquote>`)
      continue
    }

    // lists
    const ul = /^(\s*)[-*]\s+(.*)$/.exec(line)
    const ol = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      const ordered = !!ol
      const collect = []
      while (i < lines.length) {
        const m2 = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!m2) {
          if (/^\s+\S/.test(lines[i])) { collect[collect.length - 1] += ' ' + lines[i].trim(); i++; continue }
          break
        }
        collect.push(m2[3])
        i++
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${collect.map(li => `<li>${inline(file, li, outRoot)}</li>`).join('')}</${tag}>`)
      continue
    }

    // blank
    if (!line.trim()) { i++; continue }

    // paragraph
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^>\s?/.test(lines[i]) && !/^(\s*)[-*]\s+/.test(lines[i]) && !/^(\s*)\d+[.)]\s+/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    out.push(`<p>${inline(file, buf.join(' '), outRoot)}</p>`)
  }
  return out.join('\n')
}

// ---------- page assembly ----------
function rel(fromFile, toFile) {
  return relative(dirname(fromFile), toFile).replaceAll(sep, '/')
}

function pageHtml(outRoot, L, file, title, section, body, prev, next) {
  const css = rel(join(outRoot, file), join(outRoot, 'assets', 'style.css'))
  let secNav = ''
  let cur = ''
  for (const s of nav) {
    secNav += `<div class="sec">${esc(sectionOf(s, L.lang))}</div>${s.items.map(it => {
      const active = it.file === file.replace(/\.html$/, '')
      if (active) cur = sectionOf(s, L.lang)
      return `<a class="item${active ? ' active' : ''}" href="${rel(join(outRoot, file), join(outRoot, it.file + '.html'))}">${esc(titleOf(it, L.lang))}</a>`
    }).join('')}`
  }
  const pn = (p, n) => {
    let h = ''
    if (p) h += `<a class="card prev" href="${rel(join(outRoot, file), join(outRoot, p.file + '.html'))}"><div class="label">${esc(L.prev)}</div><div class="title">${esc(titleOf(p, L.lang))}</div></a>`
    if (n) h += `<a class="card next" href="${rel(join(outRoot, file), join(outRoot, n.file + '.html'))}"><div class="label">${esc(L.next)}</div><div class="title">${esc(titleOf(n, L.lang))}</div></a>`
    return `<div class="pagenav">${h}</div>`
  }
  const home = rel(join(outRoot, file), join(outRoot, 'index.html'))
  const otherOut = join(ROOT, LANGS[L.otherLang].out)
  const langHref = rel(join(outRoot, file), join(otherOut, file))
  return `<!DOCTYPE html>
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} ${esc(L.titleSuffix)}</title>
<link rel="stylesheet" href="${css}"/>
${THEME_HEAD}
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <a class="brand" href="${home}"><span class="logo">DSH</span><span><span class="name">DeepSeek Harness</span><br/><span class="sub">${esc(L.brandSub)}</span></span></a>
    ${secNav}
    <div class="controls">${THEME_BTN}<a class="ctrl" id="lang-toggle" href="${langHref}"><span class="ico">◉</span>${esc(L.langLabel)}</a></div>
  </aside>
  <main class="main">
    <div class="content">
      <div class="breadcrumb"><a href="${home}">${esc(L.home)}</a> / ${esc(cur)} / ${esc(title)}</div>
      ${body}
      ${pn(prev, next)}
      <div class="footer">${esc(L.footer)}</div>
    </div>
  </main>
</div>
${THEME_BODY}
</body>
</html>`
}

// ---------- index ----------
function indexHtml(outRoot, L, body) {
  const otherOut = join(ROOT, LANGS[L.otherLang].out)
  const langHref = rel(join(outRoot, 'index.html'), join(otherOut, 'index.html'))
  const readmeHref = L.lang === 'zh' ? 'README.md' : rel(join(outRoot, 'index.html'), join(ROOT, 'README.md'))
  const srcRoot = join(ROOT, L.src)
  const cards = nav.map(s => {
    return s.items.map(it => {
      const md = readFileSync(join(srcRoot, it.file + '.md'), 'utf8')
      const descLine = md.split(/\r?\n/).find(l => l.startsWith('> ')) || ''
      const desc = descLine.replace(/^>\s?/, '').slice(0, 110)
      return `<a class="card" href="${rel(join(outRoot, 'index.html'), join(outRoot, it.file + '.html'))}"><div class="sec-title">${esc(sectionOf(s, L.lang))}</div><div class="pg-title">${esc(titleOf(it, L.lang))}</div><div class="pg-desc">${esc(desc)}</div></a>`
    }).join('')
  }).join('')
  return `<!DOCTYPE html>
<html lang="${L.htmlLang}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DeepSeek Harness ${L.lang === 'zh' ? '白皮书 — 插件化 Agent 架构' : 'Whitepaper — A Plugin-Based Agent Architecture'}</title>
<link rel="stylesheet" href="${rel(join(outRoot, 'index.html'), join(outRoot, 'assets', 'style.css'))}"/>
${THEME_HEAD}
</head>
<body>
  <div class="topbar">${THEME_BTN}<a class="ctrl" id="lang-toggle" href="${langHref}"><span class="ico">◉</span>${esc(L.langLabel)}</a></div>
  <div class="hero">
    <div class="logo-big">DSH</div>
    ${body}
    <div class="cta">
      <a href="${rel(join(outRoot, 'index.html'), join(outRoot, 'introduction/what-is-deepseek-harness.html'))}">${esc(L.ctaStart)}</a>
      <a class="ghost" href="${readmeHref}">${esc(L.ctaReadme)}</a>
    </div>
  </div>
  <div class="grid">${cards}</div>
${THEME_BODY}
</body>
</html>`
}

// ---------- main ----------
const want = (process.argv[2] || '').toLowerCase()
const langs = want ? (want === 'all' ? ['zh', 'en'] : [want]) : ['zh', 'en']
for (const lang of langs) {
  if (!LANGS[lang]) { console.error('unknown language:', lang, '(use zh | en | all)'); process.exitCode = 1; continue }
  const L = LANGS[lang]
  const OUT = join(ROOT, L.out)
  const SRC = join(ROOT, L.src)
  mkdirSync(OUT, { recursive: true })
  cpSync(ASSETS, join(OUT, 'assets'), { recursive: true })

  const indexMd = readFileSync(join(ROOT, L.indexSrc), 'utf8')
  writeFileSync(join(OUT, 'index.html'), indexHtml(OUT, L, render('index.md', indexMd, OUT)))
  console.log(`[${lang}] built index.html`)

  for (let idx = 0; idx < flat.length; idx++) {
    const it = flat[idx]
    const srcFile = join(SRC, it.file + '.md')
    if (!existsSync(srcFile)) { console.error(`[${lang}] MISSING SOURCE:`, it.file); process.exitCode = 1; continue }
    const md = readFileSync(srcFile, 'utf8')
    const body = render(it.file + '.md', md, OUT)
    const prev = flat[idx - 1] ?? null
    const next = flat[idx + 1] ?? null
    const html = pageHtml(OUT, L, it.file + '.html', titleOf(it, lang), sectionOf(flat.find(f => f.file === it.file) ?? it, lang), body, prev, next)
    const outFile = join(OUT, it.file + '.html')
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, html)
  }
  console.log(`[${lang}] built ${flat.length} pages → ${OUT}`)
}
console.log('done')
