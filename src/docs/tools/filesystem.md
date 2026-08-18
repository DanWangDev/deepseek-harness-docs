# 文件系统工具：原子读写编辑

> 分析 DeepSeek Harness 文件系统能力（`packages/fs`）：`read`/`write`/`edit`/`read_image` 工具如何通过 `ctx.fs` seam 与观察策略协作，实现"先读后写/编辑"的安全默认与原子操作。

## 能力拆解

可选的文件系统能力由四个部分组成：

| 包 | 职责 |
|---|---|
| `dsh-fs` | `ctx.fs` + 带可选守卫的原子文本操作（Service Definition） |
| `dsh-fs-local` | 本地磁盘后端（Service Provider） |
| `dsh-fs-observation-policy` | 记录观测到的存在/缺失状态，通过 `fs/*` 事件添加新鲜度规则 |
| `dsh-tool-fs` | 面向模型的 `read`/`write`/`edit`/`read_image` 工具（Consumer） |

**替换后端不会改变策略或工具 schema**——这正是能力 seam 的意义。

## 先读后写：观察策略

没有 `dsh-fs-observation-policy` 时，文件系统 seam 是完整且不受约束的：`write` 无条件创建或覆盖，`edit` 无条件替换字面文本。加载了 `dsh-tool-fs` 的部署**按预期也应加载观察策略插件**，使默认行为为"先读后写/编辑"：

```text
模型: edit("src/foo.ts", old, new)
  → tools/pre-execute … allow
  → dsh-tool-fs 调用 ctx.fs.editText(target, old, new, expected?)
    → fs/edit-intent 事件（waterfall）
      → 观察策略：目标必须已被观测（读/写/列目录）→ 否则 deny（FS_NOT_OBSERVED）
      → 版本守卫：expected 版本必须匹配当前 → 否则 FS_STALE_VERSION
  → 原子替换或拒绝
```

它裁决 `fs/*` waterfall 来改变操作——移除该插件不会破坏工具，因为工具调用 `ctx.fs` 并分发事件，而不调用策略方法。

## 目标标识：不透明的 FsTarget

每个操作首先把用户提供的路径解析为不透明的后端目标：

```ts
/** A path resolved by a backend into a stable identity. */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /** Path for model/UI-facing output. May be a local absolute path, workspace-relative path, or remote URI. */
  displayPath: string
}
```

消费方可以显示 `displayPath`，但**禁止解析 `targetKey`**，也不得假设它是本地绝对路径。与文件系统共享执行世界的消费方通过提供方获取跨能力坐标：`processPath(target)` 返回子进程可以打开的规范化绝对路径，`fileUrl(target)` 返回 `file:` URI，`contains(parent, child)` 检查规范化身份相等或后代包含。

## 写入与编辑守卫

`writeText` 和 `editText` 的版本守卫都是可选的——省略守卫时执行无条件的裸提供方变更：

| 守卫 | 语义 |
|---|---|
| `createIfAbsent` | 目标缺失时创建；已存在时以 `FS_NOT_OBSERVED` 拒绝。即使目标在提供方初始探测后才出现也必须拒绝——发布操作本身不得替换 |
| `replaceIfVersion` | 仅在目标存在且版本匹配时替换，否则报 `FS_STALE_VERSION` |
| （省略 `expected`） | 无条件创建或覆盖 |

版本 token（`FsVersion`）由后端从高分辨率 stat 身份与新鲜度字段派生；策略层存储它用于陈旧检查，消费方**不解释其内容**。`lstat` 是路径级、不跟随链接的元数据原语——需要检查信任边界的消费方可以拒绝 `symlink`。

## 读取渲染：窗口化视图

`read` 工具渲染**窗口化**的代码视图：`offset` 是窗口请求的 1-based 起始行，`lines` 是窗口内容，`totalLines` 报告文件总行数——即使窗口为空也保留 `offset`，使 UI 永不把部分结果当作完整结果。`lang` 是从扩展名推得的语言提示，`content` 是无读取能力 UI 的回退文本。

`stat` 返回元数据（从不返回内容）；`type` 让消费方在读取前拒绝目录和特殊文件；`size` 让文本消费方无需通过失败探测即可选择 `readText` 还是 `streamText`。原始字节消费方调用 `readBytes(target, signal, maxBytes)`——必填的完整内容上限使超限以 `FS_TOO_LARGE` 失败，不会截断结果或无界缓冲。

## 工具 schema 要点

| 工具 | 行为 |
|---|---|
| `read` | 按窗口读取文本文件，渲染带行号的代码视图 |
| `write` | 创建或覆盖文件；受观察策略与版本守卫约束 |
| `edit` | 唯一字面量替换；受同样的守卫约束 |
| `read_image` | 读取图片并创建持久附件；需要 `ctx.attachments` 与支持图片输入的模型路由，否则拒绝 |

`edit` 是"唯一字面量替换"——替换文本必须在目标中唯一出现，从根上避免歧义覆盖。这就是模型侧"改代码"的原子原语：失败即报错，成功即一次干净替换，两者都作为 `tool/result` 落盘。

## 与命令工具的边界

`str_replace_editor`（来自 `dsh-tool-str-replace-editor`）是基于同一文件系统 seam 的独立查看/创建/替换/按行插入工具，可与任何 shell 或终端接口组合——它不经过 bash，也就没有 shell 注入面。设计取舍：文件编辑走专用工具而非 shell 命令，因为专用工具提供守卫、原子性与可审计的 `tool/call`/`tool/result` 事件。
