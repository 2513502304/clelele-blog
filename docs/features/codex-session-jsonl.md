# Codex session JSONL 结构说明

Codex 的 `rollout-*.jsonl` 不是一份简单聊天记录。它更像事件账本：同一次用户输入会同时服务模型上下文、终端 UI、工具调用记录、token 统计和压缩快照。直接按行渲染会看到很多重复内容，尤其是图片的 base64 和 skill 文件内容。

这份文档用通用结构解释 Codex session JSONL，再用“上传图片 + 调用 image style prompt skill + 输出绘图 prompt”这个场景说明为什么文件会膨胀。这里的例子都是脱敏示意，不包含真实图片、不包含本机路径。

## 一句话模型

可以把一个 session 分成四层：

1. session：一个 `rollout-*.jsonl` 文件，通常对应一次 Codex 线程。
2. task group：一次用户任务，从 `event_msg` / `payload.type = "task_started"` 开始，到 `event_msg` / `payload.type = "task_complete"` 结束。
3. event：JSONL 的一行，有顶层 `type`，比如 `session_meta`、`turn_context`、`response_item`、`event_msg`、`compacted`。
4. payload：该行真正的内容。多数业务字段都在 `payload` 里面，有时还会再嵌套 `content`、`item`、`info`。

注意：`task_started` 和 `task_complete` 是 `payload.type` 的取值，不是 `payload.task_started = true` 这种布尔字段。

## 单行记录的外层字段

每一行是一个 JSON 对象，常见外层字段如下：

```json
{
  "timestamp": "2026-01-01T10:00:00.000Z",
  "type": "event_msg",
  "payload": {
    "type": "user_message",
    "message": "用户输入的原始 prompt 在这里...",
    "images": ["data:image/jpeg;base64,[base64 image omitted]"]
  }
}
```

`timestamp` 是这条事件写入时的 UTC 时间。展示时可以转成站点时区；做排序时最好保留原始 ISO 字符串或转成毫秒时间戳。

`type` 是顶层事件类型。它说明这行属于哪套记录系统。

`payload` 是实际内容。很多情况下，判断业务语义主要看 `payload.type`。

## 顶层 `type`

### `session_meta`

`session_meta` 描述整个 session。它通常出现在文件开头，也可能在长会话中再次出现。里面有 session id、工作目录、CLI 版本、基础指令和 git 信息。

```json
{
  "timestamp": "2026-01-01T10:00:00.000Z",
  "type": "session_meta",
  "payload": {
    "session_id": "019f-example-session-id",
    "id": "019f-example-session-id",
    "timestamp": "2026-01-01T10:00:00.000Z",
    "cwd": "/path/to/project",
    "originator": "codex_cli",
    "cli_version": "0.0.0",
    "source": "cli",
    "thread_source": "local",
    "model_provider": "openai",
    "base_instructions": {
      "text": "系统级或开发者级基础指令..."
    },
    "git": {
      "commit_hash": "abc123",
      "branch": "feat/example",
      "repository_url": "https://github.com/example/repo"
    }
  }
}
```

这些字段适合做 session 级元数据，不适合当用户聊天内容展示。`cwd`、`repository_url` 和 `base_instructions.text` 可能带有私人路径或内部规则，公开前要脱敏。

### `turn_context`

`turn_context` 是某一轮任务的运行上下文。它描述当前目录、workspace roots、日期、时区、权限策略、模型、协作模式等。

```json
{
  "timestamp": "2026-01-01T10:00:03.000Z",
  "type": "turn_context",
  "payload": {
    "turn_id": "turn-example",
    "cwd": "/path/to/project",
    "workspace_roots": ["/path/to/project"],
    "current_date": "2026-01-01",
    "timezone": "Asia/Shanghai",
    "approval_policy": "never",
    "sandbox_policy": { "type": "danger-full-access" },
    "permission_profile": { "type": "disabled" },
    "model": "gpt-5.1-codex",
    "comp_hash": "context-hash",
    "personality": "default",
    "collaboration_mode": {
      "mode": "Default",
      "settings": {
        "model": "gpt-5.1-codex",
        "reasoning_effort": "medium",
        "developer_instructions": "..."
      }
    },
    "multi_agent_version": "1",
    "realtime_active": false,
    "effort": "medium",
    "summary": ""
  }
}
```

它对复盘很有用：同一个 prompt，在不同 `cwd`、权限、模型下结果可能不同。但它也容易泄露本地路径。

### `event_msg`

`event_msg` 更接近 Codex UI 的事件流。用户看见的用户消息、assistant 消息、任务开始结束、token 统计、压缩事件，通常都在这里。

常见 `payload.type`：

- `task_started`
- `user_message`
- `agent_message`
- `agent_reasoning`
- `token_count`
- `context_compacted`
- `task_complete`
- `turn_aborted`

`event_msg` 的优点是人类可见内容比较直接。比如 `payload.type = "user_message"` 里通常有原始用户输入，图片也会放在 `payload.images`。

### `response_item`

`response_item` 更接近模型 API 或内部 conversation item。它记录了送入模型的 message、模型输出、推理摘要、工具调用和工具结果。

常见 `payload.type`：

- `message`
- `reasoning`
- `function_call`
- `function_call_output`
- `custom_tool_call`
- `custom_tool_call_output`

比如用户上传一张图片时，`response_item` 里可能是这样的：

```json
{
  "timestamp": "2026-01-01T10:00:04.000Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "用户输入的原始 prompt 在这里..."
      },
      {
        "type": "input_image",
        "image_url": "data:image/jpeg;base64,[base64 image omitted]"
      }
    ]
  }
}
```

`response_item` 的好处是结构更接近模型上下文；坏处是它会和 `event_msg` 重复。做 UI 展示时不能两份都渲染，否则同一条用户消息会出现两次。

### `compacted`

`compacted` 是上下文压缩后的快照。它不只是“压缩成功”这类短事件，里面可能带着压缩后的上下文内容。文本压缩有效，图片 base64 基本压不动，所以带图长会话里 `compacted` 行会非常大。

```json
{
  "timestamp": "2026-01-01T12:00:00.000Z",
  "type": "compacted",
  "payload": {
    "conversation": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "旧对话摘要..." },
          { "type": "input_image", "image_url": "data:image/jpeg;base64,[base64 image omitted]" }
        ]
      }
    ]
  }
}
```

这类行不适合原样渲染，也不适合作为 gallery 的图片来源。它是上下文维护用的副本。

## 一个 task group 长什么样

一个普通任务大致是这样：

```json
[
  {
    "timestamp": "2026-01-01T10:00:01.000Z",
    "type": "event_msg",
    "payload": {
      "type": "task_started",
      "turn_id": "turn-001",
      "started_at": 1760000000.0,
      "model_context_window": 258400,
      "collaboration_mode_kind": "Default"
    }
  },
  {
    "timestamp": "2026-01-01T10:00:04.000Z",
    "type": "response_item",
    "payload": {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "用户输入的原始 prompt 在这里..."
        },
        {
          "type": "input_image",
          "image_url": "data:image/png;base64,[base64 image omitted]"
        }
      ]
    }
  },
  {
    "timestamp": "2026-01-01T10:00:04.100Z",
    "type": "event_msg",
    "payload": {
      "type": "user_message",
      "message": "用户输入的原始 prompt 在这里...",
      "images": ["data:image/png;base64,[base64 image omitted]"]
    }
  },
  {
    "timestamp": "2026-01-01T10:00:07.000Z",
    "type": "response_item",
    "payload": {
      "type": "reasoning",
      "summary": [
        {
          "type": "summary_text",
          "text": "模型内部推理摘要或空摘要..."
        }
      ]
    }
  },
  {
    "timestamp": "2026-01-01T10:00:09.000Z",
    "type": "response_item",
    "payload": {
      "type": "function_call",
      "name": "exec_command",
      "call_id": "call_001",
      "arguments": "{\"cmd\":\"sed -n '1,240p' /path/to/skill/SKILL.md\"}"
    }
  },
  {
    "timestamp": "2026-01-01T10:00:09.500Z",
    "type": "response_item",
    "payload": {
      "type": "function_call_output",
      "call_id": "call_001",
      "output": "命令输出在这里。读取 skill 时，SKILL.md 的正文会出现在这里..."
    }
  },
  {
    "timestamp": "2026-01-01T10:00:12.000Z",
    "type": "event_msg",
    "payload": {
      "type": "agent_message",
      "message": "[在此处替换为您想要生成的主体内容]，这里是 Codex 最终展示给用户的 prompt..."
    }
  },
  {
    "timestamp": "2026-01-01T10:00:12.000Z",
    "type": "response_item",
    "payload": {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "[在此处替换为您想要生成的主体内容]，这里是同一段 assistant 输出..."
        }
      ]
    }
  },
  {
    "timestamp": "2026-01-01T10:00:13.000Z",
    "type": "event_msg",
    "payload": {
      "type": "token_count",
      "info": {
        "last_token_usage": {
          "input_tokens": 26234,
          "cached_input_tokens": 4992,
          "output_tokens": 240,
          "reasoning_output_tokens": 136,
          "total_tokens": 26474
        },
        "total_token_usage": {
          "input_tokens": 26234,
          "cached_input_tokens": 4992,
          "output_tokens": 240,
          "reasoning_output_tokens": 136,
          "total_tokens": 26474
        },
        "model_context_window": 258400
      },
      "rate_limits": {
        "primary": {
          "used_percent": 12.3,
          "window_minutes": 300,
          "resets_at": 1760003600
        },
        "plan_type": "example-plan"
      }
    }
  },
  {
    "timestamp": "2026-01-01T10:00:14.000Z",
    "type": "event_msg",
    "payload": {
      "type": "task_complete",
      "turn_id": "turn-001",
      "last_agent_message": "[在此处替换为您想要生成的主体内容]，这里再次保存最后一条 assistant 可见消息...",
      "completed_at": 1760000014.0,
      "duration_ms": 13000,
      "time_to_first_token_ms": 4200
    }
  }
]
```

这段示例里有三处重复要注意：

- 用户输入和图片：`response_item` 里有一份，`event_msg.user_message` 里还有一份。
- assistant 输出：`event_msg.agent_message`、`response_item.message role=assistant`、`task_complete.last_agent_message` 可能保存同一段文本。
- skill 内容：显式调用 skill 时，skill 正文可能先作为 `response_item.message role=user` 注入一次，又通过 `function_call_output` 记录一次 shell 读取结果。

## 字段含义速查

### `payload.type = "task_started"`

`turn_id` 是这一轮任务的 id。后面的 `task_complete.turn_id` 通常会和它对应。

`started_at` 是任务开始时间，通常是 Unix timestamp。

`model_context_window` 是模型上下文窗口大小。它不是当前已使用 token 数，只是上限。

`collaboration_mode_kind` 是当前协作模式，例如 `Default`。

### `payload.type = "user_message"`

`message` 是用户在聊天框里输入的原始文本。用户只发图片时，这个字段可能是空字符串或只有换行。

`images` 是图片数组。每一项通常是 `data:image/<format>;base64,...`。这是做图片 gallery 最容易读取的一份，但也是最容易撑大 JSONL 的字段。

### `payload.type = "message"` in `response_item`

`role` 可能是 `developer`、`user`、`assistant`、`tool` 等。

`content` 是内容数组。常见 part：

- `input_text`：送入模型的文本。
- `input_image`：送入模型的图片，一般含 `image_url` 或类似字段。
- `output_text`：assistant 输出文本。

同一个 `response_item.message` 可能不是用户可见消息。比如 `role = "developer"` 可能是开发者指令，`role = "user"` 也可能是系统把 skill 内容作为用户侧上下文注入。

### `payload.type = "reasoning"`

`summary` 保存模型推理摘要。不是所有模型或所有配置都会写入可读摘要。gallery importer 通常不需要它。

### `payload.type = "function_call"`

`name` 是工具名，例如 `exec_command`。

`call_id` 用来和后续 `function_call_output.call_id` 配对。

`arguments` 通常是 JSON 字符串，不一定已经解析成对象。比如 shell 工具会把命令放在 `arguments.cmd`。

### `payload.type = "function_call_output"`

`call_id` 对应前面的工具调用。

`output` 是工具输出文本。读取 skill、读取文件、运行命令的结果都会写进这里。这里经常包含很长内容；公开前要考虑路径、代码、密钥、日志等敏感信息。

### `payload.type = "agent_message"`

`message` 是 Codex 发给用户看的 assistant 文本。对 gallery 来说，如果要抓最终绘图 prompt，这通常是最直接的来源。

### `payload.type = "token_count"`

`info.last_token_usage` 是最近一次模型请求的 token 用量。

`info.total_token_usage` 是当前 session 累计用量。

`input_tokens` 包括文本、图片和工具上下文折算后的输入 token。图片会影响模型成本，也会影响延迟。

`cached_input_tokens` 是命中缓存的输入 token。缓存能降低部分成本和延迟，但不能解决 JSONL 文件本身变大的问题。

`output_tokens` 是普通输出 token。

`reasoning_output_tokens` 是推理 token。

`model_context_window` 是上下文窗口上限。

`rate_limits` 是当前账号/计划的限流状态。这个字段不应该公开展示。

### `payload.type = "context_compacted"`

这是一个短事件，表示发生了上下文压缩。真正的大块压缩结果通常在顶层 `type = "compacted"` 行里。

### `payload.type = "task_complete"`

`last_agent_message` 是任务结束时 UI 可见的最后一条 assistant 消息。它适合作为兜底，不适合作为唯一来源，因为它只保留最后一条文本，不保留中间工具调用和用户输入结构。

`duration_ms` 是任务耗时。

`time_to_first_token_ms` 是从任务开始到首个 token 的时间。用户觉得“卡住了”，这个字段常常比总耗时更直观。

## 图片和 compact 为什么特别重

图片进入 Codex session 后，至少可能出现两次：

- `response_item.message.content[].input_image`
- `event_msg.user_message.images[]`

如果发生上下文压缩，旧图片还可能再次进入 `compacted.payload`。base64 本质上是长文本，压缩摘要很难把它变短。结果是，文本聊天能被压缩，图片基本只是被搬运。

本仓库调试时看过一个本地样本：`rollout-2026-06-30T11-21-33-019f168b-e129-7f63-8e00-38053684e229.jsonl`。它有 1450 行，总大小约 394 MB。其中包含 `data:image/` 的行约 390 MB，`compacted` 行约 275 MB。统计到的图片 base64 出现 729 次，而按 base64 字符串去重后只有 130 份，单张图片最多重复 15 次。

这不是 bug 意义上的“重复写错了”。它是 Codex 为了重放上下文、保留 UI 事件和记录压缩快照付出的代价。对普通文本任务，这个代价不明显；对一批图片风格提取任务，它会很快变成磁盘和速度问题。

## image style prompt case

显式调用 `/image-style-prompt-extractor` 时，第一轮任务通常会出现这些内容：

- 用户消息：`response_item.message role=user` 保存文本和图片。
- UI 消息：`event_msg.user_message` 再保存一份文本和图片。
- skill 注入：如果用户显式写了 skill，Codex 可能把 skill 正文作为一条 `response_item.message role=user` 注入。
- skill 文件读取：Codex 还可能调用 shell 读取 `SKILL.md`，读取结果进入 `function_call_output.output`。
- 最终 prompt：`event_msg.agent_message` 有一份，`response_item.message role=assistant` 有一份，`task_complete.last_agent_message` 还有一份。

如果用户没有输入任何文字，只发送图片，`user_message.message` 可能只是换行，但图片仍然会进入 `images` 和 `input_image`。这种情况下，gallery importer 不能因为 `message` 为空就跳过整组；它应该看图片是否存在，再找同一 task group 内后续的 prompt 输出。

多图输入也要按 group 处理。用户一次发两张图并要求“第一张只参考姿势，第二张参考其他特征”时，这两张图属于同一个 item，而不是两个独立 item。gallery 的数据结构应该允许一个 item 有 `images[]`，并把用户原始输入保存到详情页里。预览页只显示最终 output prompt。

## 解析时应该取哪份

对 gallery importer 来说，推荐规则如下：

| 目标 | 优先来源 | 兜底来源 | 原因 |
| --- | --- | --- | --- |
| task group 边界 | `event_msg.payload.type = "task_started"` / `"task_complete"` | 文件开头到结尾 | 这是用户一轮任务的自然边界 |
| 用户原始输入 | `event_msg.user_message.message` | `response_item.message role=user` 的 `input_text` | `event_msg` 更贴近用户实际输入 |
| 用户上传图片 | `event_msg.user_message.images[]` | `response_item.message.content[].input_image` | `images[]` 更好提取，后者适合作兼容 |
| assistant 最终 prompt | `event_msg.agent_message.message` | `response_item.message role=assistant` 或 `task_complete.last_agent_message` | `agent_message` 是用户实际看到的消息 |
| 工具调用 | `response_item.function_call` | 无 | 工具调用只在 response item 中结构化保存 |
| 工具输出 | `response_item.function_call_output` | 无 | 可用于审计，不适合默认展示 |
| token 成本 | `event_msg.token_count.info` | 无 | 用它做成本和速度分析 |
| compact 快照 | 不作为内容源 | 只用于大小统计 | 避免重复导入旧图片 |

不要把 `compacted` 当作普通聊天内容。它是维护上下文的快照，里面可能含历史图片副本。

## 对 `openai/euphony` 的参考价值

`openai/euphony` 是一个 Codex session / Harmony JSONL viewer。它的 README 写明：可以从剪贴板、本地 `.jsonl`、HTTP(S) URL 读取数据，并自动识别 Codex session JSONL。源码里的 `src/utils/codex-session.ts` 做了几件值得借鉴的事：

- 先把 JSONL 规范化成事件数组，再用已知顶层类型判断是不是 Codex session。
- 识别 `session_meta`、`response_item`、`event_msg`、`turn_context`、`compacted`。
- 对 `response_item.message`、`reasoning`、`function_call`、`function_call_output` 分别渲染。
- 如果已经存在 `response_item` 用户/assistant 消息，就避免再把 `event_msg.user_message` / `agent_message` 渲染一遍。
- 对 Codex session 会尽量取完整事件流，而不是只拿分页的前几行。

我们不能完全照搬它。Euphony 更像通用 viewer，重点是把 session 变成一条可读 timeline；gallery importer 需要按 task group 提取“图片组 + 用户原始输入 + 最终 prompt”。所以我们要保留 `task_started` / `task_complete` 这类边界事件，也要主动忽略 `compacted` 里的历史图片副本。

参考链接：

- https://github.com/openai/euphony
- https://openai.github.io/euphony/

## 对性能和存储的判断

用 Codex 对话来批量做图片风格 prompt 提取，体验会越来越差。原因不是模型不会做，而是 session 账本会越写越重：

- base64 图片会重复进入多种事件。
- compact 会把历史图片再次写入 JSONL。
- 长 session 的上下文恢复会越来越慢。
- 新任务开始时，Codex 需要处理更多历史状态，首 token 延迟会上升。
- JSONL 占用的是本机磁盘，和模型 token 成本是两套问题；缓存 token 也不会让 JSONL 变小。

更适合的方案是：把图片风格提取做成无上下文的 API 调用。每次请求只传当前图片和当前指令，返回 prompt 后把图片 hash、缩略图、原图 URL、用户输入、输出 prompt 写入 gallery 数据源。图片存 Hugging Face bucket 或其他对象存储，repo 只存 metadata。Codex 仍然适合开发 importer、写 UI、调试解析逻辑，但不适合长期作为图片批处理容器。

## 建议的 importer 行为

对 `scripts/import-style-prompts.mjs` 这类导入器，建议保持这些规则：

1. 流式读取 JSONL，不要为了预览把整份文件和所有 base64 都塞进浏览器。
2. 只从 task group 的原始用户输入里取图片，跳过 `compacted`。
3. 用图片 bytes 的 SHA-256 做去重。多图 item 用多个图片 hash 拼成 group hash。
4. 允许一个 item 持有多张参考图。
5. 保存 `originalPrompt`，但把指向本地 `SKILL.md` 的绝对路径脱敏成 `/skill-name`。
6. 预览页只加载缩略图和最终 prompt；详情页再显示原始输入和多图说明。
7. 更新 metadata 时不要重新上传图片。
8. 日志要区分“跳过重复图片”和“已匹配已有 item 并更新 metadata”。

常用命令：

```bash
npm run import:style-prompts -- /path/to/rollout-session.jsonl
```

只更新已有 item 的 metadata：

```bash
npm run import:style-prompts -- /path/to/rollout-session.jsonl --metadata-only
```

等价的直接脚本命令：

```bash
node scripts/import-style-prompts.mjs /path/to/rollout-session.jsonl --metadata-only
```

生成或更新过的 item 文件最后一行可以保留一条可复现命令。不要写本机绝对路径：

```js
// script: node scripts/import-style-prompts.mjs /path/to/rollout-session.jsonl --metadata-only
// npm run import:style-prompts -- /path/to/rollout-session.jsonl --metadata-only
```

## 公开展示时不要展示什么

不要直接展示原始 JSONL。它太重，也容易泄露：

- 本地 home 目录和项目路径。
- git 远端、branch、commit。
- skill 文件完整内容。
- shell 命令和命令输出。
- rate limit、账号计划、运行环境。
- 图片 base64。
- compact 后的历史上下文。

gallery 页面应该展示用户真正关心的东西：参考图、最终 prompt、必要时展示脱敏后的原始用户要求。其他内容留给本地调试工具。
