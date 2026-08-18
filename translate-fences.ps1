# Translate CJK text inside fenced code blocks of the EN docs. Touches ONLY fence lines.
$ErrorActionPreference = 'Stop'

function Set-FileLines($path, $lines) {
  Set-Content -Path $path -Value $lines -Encoding utf8
}

function Apply-FenceMap($path, $map, $align = $false) {
  $lines = Get-Content -Path $path
  $inFence = $false
  $out = New-Object System.Collections.Generic.List[string]
  $unused = New-Object System.Collections.Generic.HashSet[string]
  foreach ($k in $map.Keys) { [void]$unused.Add($k) }
  foreach ($line in $lines) {
    if ($line -match '^```') {
      $inFence = -not $inFence
      $out.Add($line)
      continue
    }
    if ($inFence -and $map.ContainsKey($line)) {
      [void]$unused.Remove($line)
      $new = $map[$line]
      if ($align) {
        foreach ($ch in @([string][char]0x2192, [string][char]0x2190)) {
          $ci = $line.IndexOf($ch)
          if ($ci -ge 0) {
            $ni = $new.IndexOf($ch)
            if ($ni -ge 0 -and $ni -lt $ci) {
              $new = $new.Substring(0, $ni) + (' ' * ($ci - $ni)) + $new.Substring($ni)
            }
            break
          }
        }
      }
      $out.Add($new)
      continue
    }
    $out.Add($line)
  }
  Set-FileLines $path $out
  if ($unused.Count -gt 0) {
    Write-Output ("UNMATCHED KEYS in {0}:" -f $path)
    foreach ($k in $unused) { Write-Output ("  [{0}]" -f $k) }
  } else {
    Write-Output ("OK {0} ({1} mappings)" -f $path, $map.Count)
  }
}

# ---- 1) what-is-deepseek-harness: boxed diagram, inner width 60 ----
$boxPath = 'G:\deepseek-harness-docs\src\docs\en\introduction\what-is-deepseek-harness.md'
$boxLines = Get-Content $boxPath
$innerMap = @{
  '1. 外壳层 (dsh web → Web UI / CLI / ACP / Python SDK)' = '1. Shell layer (dsh web → Web UI / CLI / ACP / Python SDK)'
  'dsh --profile web 启动浏览器应用；输入进入 Agent inbox' = '    dsh --profile web starts the app; input → Agent inbox'
  '2. 循环层 (core/agent-loop — ctx.agentLoop)' = '2. Loop layer (core/agent-loop — ctx.agentLoop)'
  'turn/start → 认领 inbox 消息 → 组装提示词与工具 schema' = '    turn/start → claim inbox → assemble prompt + schema'
  '3. 组装层 (core/system-prompt — ctx.systemPrompt)' = '3. Assembly layer (core/system-prompt — ctx.systemPrompt)'
  '按 order 拼接提示词段落 + ctx.tools.schemas() 工具清单' = '    sections by order + ctx.tools.schemas() tool list'
  '4. 模型层 (llm/llm — ctx.llm)' = '4. Model layer (llm/llm — ctx.llm)'
  'agent/request → llm/stream 流式请求 → assistant/chunk*' = '    agent/request → llm/stream streaming → assistant/chunk*'
  '5. 工具层 (core/tools — ctx.tools)' = '5. Tool layer (core/tools — ctx.tools)'
  'tool/call → pre-execute 审批 → execute → post-execute' = '    tool/call → pre-execute approve → execute → post-execute'
  '→ 实际执行: bash / read / write / grep / subagent ...' = '    → actual: bash / read / write / grep / subagent ...'
  '6. 持久层 (core/session + persistence)' = '6. Persistence layer (core/session + persistence)'
  '每个模型可见的事实追加为 SessionEvent → JSONL/SQLite' = '    model-visible facts → SessionEvent → JSONL/SQLite'
}
$inFence = $false
$boxOut = New-Object System.Collections.Generic.List[string]
$unusedBox = New-Object System.Collections.Generic.HashSet[string]
foreach ($k in $innerMap.Keys) { [void]$unusedBox.Add($k) }
foreach ($line in $boxLines) {
  if ($line -match '^```') { $inFence = -not $inFence; $boxOut.Add($line); continue }
  if ($inFence -and $line -match '^│(.*)│$') {
    $inner = $Matches[1].Trim()
    if ($innerMap.ContainsKey($inner)) {
      [void]$unusedBox.Remove($inner)
      $newInner = $innerMap[$inner]
      if ($newInner.Length -gt 60) { Write-Output ("OVERFLOW ({0}): {1}" -f $newInner.Length, $newInner) }
      $boxOut.Add('│' + $newInner.PadRight(60) + '│')
      continue
    }
  }
  $boxOut.Add($line)
}
Set-FileLines $boxPath $boxOut
if ($unusedBox.Count -gt 0) { Write-Output 'UNMATCHED box keys:'; foreach ($k in $unusedBox) { Write-Output ("  [{0}]" -f $k) } } else { Write-Output ("OK box diagram ({0} lines)" -f $innerMap.Count) }

# ---- 2) architecture-overview: layer tree diagram ----
Apply-FenceMap 'G:\deepseek-harness-docs\src\docs\en\introduction\architecture-overview.md' @{
  '空条目列表' = 'Empty entry list'
  '  ├── profile 列出的每个组合包（按顺序）' = '  ├── each bundle listed by the profile (in order)'
  '  ├── profile 的 cordis.patch.yml' = '  ├── the profile''s cordis.patch.yml'
  '  ├── home 级的 cordis.patch.yml' = '  ├── the home-level cordis.patch.yml'
  '  └── 任意 --patch overlay（优先级最高）' = '  └── any --patch overlay (highest priority)'
}

# ---- 3) cordis: waterfall diagram + TS comments ----
Apply-FenceMap 'G:\deepseek-harness-docs\src\docs\en\core\cordis.md' @{
  '最外层监听器 (waterfall listener A)' = 'Outermost listener (waterfall listener A)'
  '  └─ next() ──► 下游监听器 B' = '  └─ next() ──► downstream listener B'
  '                 └─ next() ──► 默认行为（调用方）' = '                 └─ next() ──► default behavior (the caller)'
  '                 ◄─ 返回值 ───┘' = '                 ◄─ return value ───┘'
  '  ◄─ 包装后返回 ──┘' = '  ◄─ wrapped return ──┘'
  '// 模式示意' = '// Schematic of the pattern'
  'type Thing = ThingMap[keyof ThingMap]  // 可辨识联合' = 'type Thing = ThingMap[keyof ThingMap]  // discriminated union'
  '// 插件扩展它，而不触碰源码包' = '// A plugin extends it without touching the source package'
}

# ---- 4) the-loop: turn structure diagram + tool pipeline ----
Apply-FenceMap 'G:\deepseek-harness-docs\src\docs\en\core\the-loop.md' @{
  '① inbox 认领' = '① inbox claim'
  '   claim(target)：取出全部 next-step 输入 + 轮次边界上的一条 next-turn 消息' = '   claim(target): take all next-step inputs + one next-turn message at the turn boundary'
  '   → agent/pre-step（waterfall）：reject 或 enter(messages)' = '   → agent/pre-step (waterfall): reject or enter(messages)'
  '② 提示词组装' = '② prompt assembly'
  '   ctx.systemPrompt 拼接提示词段落（PromptSection）' = '   ctx.systemPrompt concatenates prompt sections (PromptSection)'
  '   + ctx.tools.schemas(scope) 工具 schema 允许列表' = '   + ctx.tools.schemas(scope) tool schema allowlist'
  '   → request/header 事件：完整请求信封写入日志' = '   → request/header event: full request envelope written to the log'
  '③ 历史派生' = '③ history derivation'
  '   从会话日志 deriveMessages() 投影模型历史（surface 是唯一来源）' = '   deriveMessages() projects model history from the session log (the surface is the only source)'
  '④ 流式模型调用' = '④ streaming model call'
  '   agent/request（waterfall，可替换冻结的调用配置）' = '   agent/request (waterfall; can replace the frozen call config)'
  '   → llm/stream → assistant/chunk*（原始分片）→ assistant/message（组装后消息）' = '   → llm/stream → assistant/chunk* (raw chunks) → assistant/message (assembled message)'
  '⑤ 工具执行' = '⑤ tool execution'
  '   tool/call* → tools/pre-execute（allow/deny/ask）' = '   tool/call* → tools/pre-execute (allow/deny/ask)'
  '   → ToolGuard（单调 guard）→ tools/execute（环绕分派）' = '   → ToolGuard (monotonic guard) → tools/execute (around dispatch)'
  '   → tools/post-execute（检查/替换结果）→ tool/result*' = '   → tools/post-execute (inspect/replace result) → tool/result*'
  '⑥ 继续或终止' = '⑥ continue or terminate'
  '   工具还欠另一个请求？next-step 输入已到达？→ 认领 → 下一个 step' = '   Tools still owe another request? next-step input arrived? → claim → next step'
  '   否则 → agent/turn-stopping（serial）→ turn/end' = '   Otherwise → agent/turn-stopping (serial) → turn/end'
  'tools/pre-execute (waterfall)   → allow | deny | ask（approval 服务裁决）' = 'tools/pre-execute (waterfall) → allow | deny | ask (the approval service decides)'
  'ToolGuard（单调）                → 返回 reason 即拒绝；无法撤销' = 'ToolGuard (monotonic) → returning a reason rejects; cannot be undone'
  'tools/execute (waterfall)       → 环绕分派：超时、重试、指标' = 'tools/execute (waterfall) → around dispatch: timeout, retry, metrics'
  'finalizeContent（工具自有）      → 最后一英里内容变换' = 'finalizeContent (tool-owned) → last-mile content transform'
  'tools/result (emit)             → 冻结的最终结果，观察者无法变换' = 'tools/result (emit) → frozen final result; observers cannot transform it'
} $true

# ---- 5) system-prompt: assembly diagram + practice TS comments ----
Apply-FenceMap 'G:\deepseek-harness-docs\src\docs\en\core\system-prompt.md' @{
  '插件 A 注册 section("harness:identity", order=-100)' = 'Plugin A registers section("harness:identity", order=-100)'
  '插件 B 注册 section("deployment:persona", order=0)' = 'Plugin B registers section("deployment:persona", order=0)'
  '插件 C 注册 section("tool:guidance", order=150)' = 'Plugin C registers section("tool:guidance", order=150)'
  '插件 D 注册 context("workspace:notice", order=10)' = 'Plugin D registers context("workspace:notice", order=10)'
  '         ▼ 组装（per step）' = '         ▼ assembly (per step)'
  '   sections 按 order 升序拼接' = '   sections concatenated in ascending order'
  '   + ctx.tools.schemas(scope) 工具 schema 允许列表' = '   + ctx.tools.schemas(scope) tool schema allowlist'
  '   request/header 事件写入日志（EpochHeader.system + .tools）' = '   request/header event written to the log (EpochHeader.system + .tools)'
  '    order: 120,                       // 工具指引区间' = '    order: 120,                       // tool-guidance range'
  '  // disposer 由 effect 自动管理：插件卸载时该段被撤销' = '  // the disposer is managed automatically by the effect: the section is revoked when the plugin unloads'
}

# ---- 6) scope: shadowing diagram ----
Apply-FenceMap 'G:\deepseek-harness-docs\src\docs\en\core\scope.md' @{
  '全局工具 register("bash", …)' = 'global tool register("bash", …)'
  'agent A scope: register("bash", …)   ← A 看到自己的 bash' = 'agent A scope: register("bash", …) ← A sees its own bash'
  'agent B scope: （无注册）             ← B 看到全局 bash' = 'agent B scope: (none registered) ← B sees the global bash'
} $true

Write-Output 'DONE'
