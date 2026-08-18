# 插件开发：从注册到生效

> 手把手拆解 DeepSeek Harness 插件开发的完整链路：从 `apply(ctx)` 入口、`inject` 依赖声明、注册副作用与 disposer，到分发为组合包（bundle）与 patch 层的配置覆盖。

## 一个最小的插件

Cordis 插件是一个带有可选 `inject` 和 `apply(ctx)` 字段的对象：

```ts
import { Context } from '@deepseek-ai/cordis'

// 声明依赖：等服务就绪才启动
export const name = 'my-plugin'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context) {
  // 注册一个工具（defineTool DSL 负责 schema 与校验）
  ctx.tools.register(defineTool({
    name: 'my_tool',
    description: 'Do something useful.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: { schema: { type: 'object' } },
    execute: async (args) => ({ echoed: args.input }),
  }))

  // 注册一段提示词（order 决定拼接位置）
  ctx.systemPrompt.section({
    name: 'my-plugin:guidance',
    order: 120,
    text: 'When asked about X, prefer Y.',
  })

  // 监听事件（返回 disposer 的注册会被自动撤销）
  ctx.on('session/event', (session, event) => {
    console.log(session.id, event.type)
  })
}
```

**注册是可逆的副作用**：`ctx.effect()` / `ctx.on()` 返回 disposer；reload 与 teardown 时按预期撤销。插件卸载时，它注册的工具从提示词消失并拒绝执行——与不存在的工具无法区分。

## 五个核心概念回顾

| 概念 | 在插件中的体现 |
|---|---|
| 插件是实现 Service 的对象 | `apply(ctx)` 函数或 `Service` 子类 |
| 上下文是服务的容器 | 通过 `ctx.tools`、`ctx.llm`、`ctx.sessions` 等 key 查找服务 |
| `inject` 声明依赖 | 服务就绪才启动；加载顺序由依赖表达 |
| 类型化事件通信 | 声明合并扩展事件 map，按 `@mode` 分发 |
| 注册是可逆副作用 | 每个注册对应 disposer |

## 从插件到组合包（bundle）

插件代码要进入运行中的 dsh，需要一个**组合条目**（cordis.yml 里的行）+ 挂载代码。组合包（bundle）就是"配置项 + 挂载代码"的分发格式：

```yaml
# cordis.patch.yml（一个 bundle 的 patch 文件示意）
services:
  my-plugin:                      # 按 id 定位条目
    config:
      option: value
```

patch 按 id **整行替换** config（无 deep-merge）；`dsh.profile.bundles` 列出 profile 叠放的组合包。加载顺序：profile 列出的 bundles → profile 的 `cordis.patch.yml` → home 级 → 任意 `--patch` overlay。

## 工具开发的完整清单

| 步骤 | 要点 |
|---|---|
| 定义 schema | `defineTool({ name, description, parameters, output, execute })`；`parameters` 是隐式开放对象根，必填属性带 `required: true` |
| 声明输出 | `output.schema`（强制执行的 JSON Schema 子集）+ `render(args, value)` 纯投影 |
| 处理取消 | `execute` 必须观察或转发 `exec.signal`，在自有工作达到 quiescence 后结算 |
| 声明并发 | 可与兄弟重叠时 `isConcurrencySafe(args)` 返回 `true`；否则保持独占 |
| 声明超时 | `timeoutMs`（协作式预算；`dsh-tool-call-timeout-policy` 执行 `tools/execute` 包装） |
| 声明展示 | `presentCall`/`presentResult` 返回 card 渲染意图（`generic`/`terminal`/`diff`/`search`/`read`/`web`） |
| 写 README | 包契约：config、语义、限制、扩展点与 Model Experience |

## 注册表 API 速查

| 注册表 | 方法 | 语义 |
|---|---|---|
| `ctx.tools` | `register(def)` / `restrict(filter)` / `guard(fn)` / `schemas(scope)` | 注册/过滤/单调 guard/白名单投影 |
| `ctx.systemPrompt` | `section(s)` / `context(c)` | 提示词段落/动态上下文 |
| `ctx.commands` | `register(def)` | 人类命令（斜杠命令，不经模型轮次） |
| `ctx.jobs` | `start(jobStart)` | 后台任务注册 |
| `ctx.agents` | `create()` / `resume()` | 创建/恢复 agent（经工厂） |
| `ctx.llm` | 注册适配器 | 添加模型提供方 |
| `ctx.subagents` | 注册提供方 | 添加委派后端 |

## 常见坑

* **waterfall 必须调用 `next()`**：不调用直接返回即短路——只做观察的监听器必须委托
* **guard 是单调的**：返回 reason 即拒绝，无法被后续监听器撤销；guard 没有 allow 结果
* **模型可见即已记录**：新增模型可见输入必须新增会话事件，从日志渲染
* **`DEFAULT_*` 常量不是配置**：部署可变的选项是校验过的 `Config` 字段，从 cordis.yml 可改
* **注册表主体事件不过滤**：关于注册表本身的事件保持 unfiltered dispatch

## 更多资源

* 教程：[Cordis 教程](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-tutorial/index.zh.md)（7 课，从第一个插件到 harness 实战）
* 实操：[扩展实操手册](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/extension-cookbook.zh.md)（功能 → 能力映射）
* 包模板：[adding-a-package](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-package.zh.md)、[adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cookbook/adding-a-tool.zh.md)
