# Skills：技能系统

> 深入剖析 DeepSeek Harness 的 Skills 系统：从磁盘加载、frontmatter 解析、调用策略（model/user invocable）、发现优先级到面向模型的 `skill` 工具——一条完整的技能生命周期链路。

## 什么是 Skill

Skill（技能）是一份**可复用的任务指令**：`<name>/SKILL.md` 或 `<name>.md`。skill 是可选的指令而非会话事件——因此其词汇定义在 `packages/skill` 而不是 core。模型通过 `skill` 工具按需加载正文，正文内容经 `agent.inject()` 作为 user/message 注入下一次请求。

## 能力拆解

| 角色 | 包 |
|---|---|
| Service Definition | `dsh-skill`（`ctx.skills` 注册表） |
| Service Provider | `dsh-skill-filesystem`（本地目录提供方）、`dsh-skill-badge`（可选随包徽章提供方） |
| Consumer | `dsh-tool-skill`（面向模型的 `skill` 工具） |

## 提供方注册表

`ctx.skills` 组合本地、内嵌、远程或其他提供方：

* 注册是同步的；远程初始化与发现属于 `list()` 的 await 阶段
* 采用**宿主 + 按 scope 的分层结构**：注册落入调用方上下文 scope 对应的层，读取时将全局层与观察 scope 的链合并——最近层的条目直接赢得重名 skill
* 发现缓存以解析后的 scope 链为键；提供方和运行时变更发出 `skills/change` 失效事件（不带 diff，消费方重新 `snapshot()`）

```ts
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  readonly name: string
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

## 本地发现优先级

随附的本地提供方按 rank 顺序扫描各根目录：

| Rank | Source | Root |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir`（配置时） |

项目根目录为包含 `.git` 的最近祖先目录（找不到时用当前 cwd）；当 `ctx.fs` 可用时，git-root 向上查找通过文件系统服务探测 `.git`，使远程或沙箱工作区不会回退到宿主文件系统边界。Chokidar 监视目录变更，watcher 失败使当前观测不完整但不会隐藏可读候选项。

## 调用策略：model/user invocable

```ts
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

本地提供方读取名称完全匹配的 kebab-case frontmatter 键 `disable-model-invocation` 和 `user-invocable`，省略的字段默认为 `true`。四个组合都保留：

| modelInvocable | userInvocable | 效果 |
|---|---|---|
| true | true | 模型与人类都可调用（默认） |
| true | false | 仅模型可调用 |
| false | true | 仅人类可调用（命令目录） |
| false | false | 只能由受信的 `ctx.skills.get()` 调用方获取 |

## skill 身份与加载

* 名称是 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）
* 本地提供方接受目录包（`<name>/SKILL.md`）与扁平 Markdown 文件（`<name>.md`）；不支持嵌套递归的 `**/SKILL.md`
* 模型会话目录仅使用可调用 skill 的 `name` 和 `description`——**从不使用正文或绝对文件路径**
* 完整的 `SkillSummary` 携带 `whenToUse`（额外路由指引）、`source`、`provider` 与 `resourceBase`

## 面向模型的工具

`skill` 工具（`dsh-tool-skill`）：

* 消费方拥有初始目录和替换目录：目录变化时经 `agent.inject()` 作为 user/message **替换**注入（`form: 'catalog'`）
* 模型按名称加载 skill 正文，正文作为 `form: 'instructions'` 的注入上下文进入下一次请求
* 发现不完整（提供方失败）时结果不可缓存——消费方保留上一份经过自身过滤的可用目录并重试

## 生命周期链路

```text
磁盘 (SKILL.md) → 提供方 list() 发现 → 注册表合并分层目录
  → skill 工具列出目录（modelInvocable 过滤）
  → 模型调用 skill("graphify")
  → 获胜提供方 get() 返回 SkillDefinition
  → 正文经 agent.inject() 注入 → 下一次 pre-step 进入请求
```

## 与参考实现的对比

Claude Code 的 Skills 系统有"预算感知描述截断、双模式执行（inline/fork）、权限白名单、条件激活、动态发现到远程技能加载"。DeepSeek Harness 的版本同样从磁盘加载、支持 frontmatter 与动态发现，但**不引入独立的执行模式**——skill 就是注入指令，执行仍走统一的工具流水线；权限与沙箱由既有的审批/沙箱策略覆盖，不需要 skill 自带的权限白名单。
