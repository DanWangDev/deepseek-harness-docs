// 站点校验脚本（零依赖）：检查页面完整性、内部链接、主题/语言切换控件
// 用法: node scripts/verify.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const nav = JSON.parse(readFileSync(join(ROOT, 'nav.json'), 'utf8'))
const flat = nav.flatMap(sec => sec.items.map(it => it.file))
const roots = { zh: join(ROOT, 'site'), en: join(ROOT, 'site', 'en') }
let failed = 0

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.html')) out.push(p)
  }
  return out
}

for (const [lang, root] of Object.entries(roots)) {
  // 1. page presence
  const missing = flat.filter(f => !existsSync(join(root, f + '.html')))
  if (missing.length) { failed++; console.error(`[${lang}] MISSING PAGES:`, missing) }
  else console.log(`[${lang}] all ${flat.length} pages present`)

  // 2. internal links
  const bad = []
  for (const f of walk(root)) {
    const html = readFileSync(f, 'utf8')
    const re = /href="([^"#]+)(?:#[^"]*)?"/g
    let m
    while ((m = re.exec(html))) {
      const t = m[1]
      if (/^https?:\/\//.test(t)) continue
      const p = resolve(dirname(f), t)
      if (!existsSync(p)) bad.push(`${f.replace(root, '')} -> ${t}`)
    }
  }
  if (bad.length) { failed++; console.error(`[${lang}] BROKEN LINKS:\n${bad.slice(0, 15).join('\n')}`) }
  else console.log(`[${lang}] all internal links resolve`)

  // 3. theme + lang controls
  let noTheme = 0, noLang = 0, noIndex = 0
  for (const f of walk(root)) {
    const html = readFileSync(f, 'utf8')
    if (!html.includes('theme-toggle')) noTheme++
    if (!html.includes('lang-toggle')) noLang++
    if (f.endsWith(join(root, 'index.html'))) noIndex++
  }
  if (noTheme) { failed++; console.error(`[${lang}] pages missing theme-toggle: ${noTheme}`) }
  else console.log(`[${lang}] theme toggle present on all pages`)
  if (noLang) { failed++; console.error(`[${lang}] pages missing lang-toggle: ${noLang}`) }
  else console.log(`[${lang}] language toggle present on all pages`)
  if (!existsSync(join(root, 'index.html'))) { failed++; console.error(`[${lang}] index.html missing`) }
}

// 4. en source presence
const enSrc = flat.filter(f => !existsSync(join(ROOT, 'src', 'docs', 'en', f + '.md')))
if (enSrc.length) { failed++; console.error('MISSING EN SOURCES:', enSrc) }
else console.log('all EN sources present')

console.log(failed ? `\nVERIFY FAILED (${failed} issue(s))` : '\nVERIFY OK')
process.exit(failed ? 1 : 0)
