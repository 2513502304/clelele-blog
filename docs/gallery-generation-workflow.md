# 从 Gallery 模板改写 prompt、批量生图与上传

这套流程保存两层信息：网页里的 sub-image 展示图片、平台和完整生成 prompt；私有 HF 回执保存源模板、角色设定、文本改写请求与响应、生图参数、供应商响应和原图 hash。以后扩展功能时，可以从回执找回当时的输入，不必只靠一段 note 猜测图片来源。

## 代码放在哪里

可执行实现统一放在本仓库：入口是 `scripts/generate-style-examples.py`，配套模块在 `scripts/lib/`。`My-AGENT-Configuration` 仓库的 `gallery-image-generation` 技能负责使用说明、验收场景和定位入口，没有第二套 pipeline 实现。

- 手动运行：直接在 blog 中执行下面的 Python 命令，无需安装 Agent 或全局技能。
- Agent 调用：技能的 `scripts/run_pipeline.py --repo /path/to/clelele-blog` 转发到同一份代码。也可以设置 `GALLERY_REPO`，或在 blog 目录中自动识别；优先级是显式路径、环境变量、当前目录的父目录。
- 找不到 checkout 时直接报错，不悄悄下载代码或切到另一份实现。技能与 blog 分别升级，执行的是用户指定 checkout 中的代码。

模板读取、改写、PixAI 生图和下载只用 Python 3.10+ 标准库，当前支持 macOS/Linux。HF 上传复用 blog 的 Node 脚本，因此上传阶段还需要仓库依赖和已有 HF 配置。Codex 内置生图需要 Agent 调用工具；独立 OpenAI API 需要另外的 key 与 SDK，不能拿内置工具实测来证明独立 API 可用。

## 分开运行每个阶段

下面的 `campaign.json` 是用户自己的配置文件，`output/.../autumn` 是同一批任务反复使用的输出目录。初次可参考 [完整配置](../scripts/examples/gallery-generation/campaign.json) 或 [仅导出 prompt 的配置](../scripts/examples/gallery-generation/rewrite-only.json)。

```bash
# 选择模板、展开次数，保存本地 plan.json；不调用收费 API、不写 HF
python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn

# 只改写：仅需文本模型 key，不需要 PixAI/OpenAI key 或图片任务额度
python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --stage rewrite --apply

# 只生图：读取已有改写结果，仅需 PixAI key，不再请求文本模型
python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --stage generate --ledger output/gallery-generation/pixai-ledger.json --max-tasks 20 --apply

# 只上传已有图片与回执：无需文本或生图 key，需现有 HF 配置
python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --stage upload --apply

# 无人值守运行已支持的完整流程
python3 scripts/generate-style-examples.py --config campaign.json --output output/gallery-generation/autumn --max-tasks 20 --apply --upload
```

没有 `--apply` 时只列计划。`--stage plan` 即使带了 `--apply` 也不发起收费请求。`--upload` 只用于 `all` 或 `generate` 后追加发布；单独上传用 `--stage upload`。需要让独立任务遇错后继续，可加 `--continue-on-error`，它不会重新提交失败的付费请求。

改写结果在 `<out>/prompts.json`，每个改写目录还有 `prompt.txt`、`openai-prompt.txt`、`pixai-prompt.txt` 和包含完整请求/响应的 `prepared.json`。`prompt.txt` 使用角色原名称，可以复制到 Nano Banana、NovelAI 等网页。`tagPrompt` / `pixai-prompt.txt` 只把名称替换成角色 tag；是否适合其他平台仍取决于该平台，不代表这些平台的 API 已接入或通过验证。

文本供应商与生图供应商独立配置。`rewrite.baseUrl` 是兼容 Chat Completions 的 API 根路径（脚本在后面接 `/chat/completions`），`model` 是模型 ID，`keyEnv` 是环境变量名。默认是 DeepSeek 的 `deepseek-flash`。可以更换兼容服务；目前真实实验只验证了 DeepSeek，其余服务需要各自测试，不能因为协议相似就声称全部兼容。

若只需要文本，配置可以完全省略 `profiles`，run 只写 `character`。也可将某个 profile 写成 `{"provider":"external","model":"Nano Banana"}`，表明准备拿到网页上手动生成。`rewrite` 不会检查该平台的 key；`all/generate` 会在任何付费调用之前明确拒绝无法自动执行的平台。`codex-imagegen` 同理，需要 Agent 按计划调用内置工具。

## 配置怎么组合

角色定义、生成参数和模板选择分别保存。`charactersFile`、`profilesFile` 都相对于配置文件所在目录解析，也可以直接内嵌 `characters`、`profiles`；同一项不能同时采用两种来源。参考 [角色文件](../scripts/examples/gallery-generation/characters.json) 和 [参数文件](../scripts/examples/gallery-generation/profiles.json)。

```json
{
  "version": 1,
  "id": "autumn-01",
  "charactersFile": "characters.json",
  "profilesFile": "profiles.json",
  "rewrite": {"baseUrl": "https://api.deepseek.com", "model": "deepseek-flash", "keyEnv": "DEEPSEEK_API_KEY"},
  "selections": [{
    "id": "chosen",
    "select": {"hashes": ["e109a23b4126", "4f418ed8123e"]},
    "runs": [
      {"id": "elaina-wide", "character": "elaina", "profile": "landscape", "tasksPerHash": 2},
      {"id": "kita-portrait", "character": "kita", "profile": "portrait", "tasksPerHash": 1}
    ]
  }]
}
```

这里的每张卡片安排三次生图提交：伊蕾娜横图两次，喜多郁代竖图一次。若两种 profile 都设为每批四张，就是每张卡片最多十二张图，两张卡片最多二十四张。每个 run 已经是一组明确的“角色 + 参数 + 次数”，脚本不会在背后再做一次排列组合。

同一模板与角色只改写一次。两个参数 profile，或同一 profile 重复三次，都共享该改写文本，但各自有独立的生成任务 ID、目录和回执。`tasksPerHash` 统计提交尝试，失败和结果不确定也占一次，不保证最终成功图片数。`--max-tasks` 则限制整份共享账本的总尝试次数，两者不能混用。

PixAI 默认请求 Tsubaki.3、ultra、REST `1.5k`、3:4、四张、随机 seed、helper 关闭。比例、size、质量、数量、seed、model version 可以配置。已验证的是 Tsubaki.3；其他模型即使接受同一 API，也需核实参数支持。固定 seed 配合重复任务可能得到相同图片，计划会提示，不偷偷递增 seed。

### 按范围选择

将上例的 `select` 替换为：

```json
{
  "range": {"dateFrom": "2026-09-20", "dateThrough": "2026-09-25", "positions": [1, 10], "order": "date-desc"},
  "excludeHashes": ["e109a23b4126"]
}
```

日期按北京时间解释，包含首尾两天，以 catalog 的实际时间字段判断，不猜 slug 中的日期。先按日期筛选并排除，再排序，最后取序号范围。`positions` 从 1 开始，两端均包含；日期相同的卡片以完整 hash、slug 决定稳定次序。可以只用日期范围，也可以只用序号范围。空结果、倒置或越界范围都会报错。

hash 是卡片标识，不是可以加减的数值范围。短 hash 必须唯一匹配，也可以填写完整 slug。跨 selection 选到同一张卡片会报错；需要更多尝试时，把它们放在同一 selection 的多个 runs 中，或用 `excludeHashes` 去掉重叠。

一张卡片可能有多个模型 prompt。此时不能默认取第一条；在该 selection 中增加 `promptIds: {"卡片hash": "完整64位promptID"}` 明确选择。每张卡片只选一个 variant，防止“每卡片两次”无意中乘上多个 prompt 的数量。

首轮选择会写入 `plan.json`，包括最终完整 hash、slug、variant、模板、角色、参数和次数。后续阶段直接读这份计划，即使网站新增卡片，“最新十张”也不会变。修改配置或外部角色文件时需要新 campaign ID 与输出目录；不能用原任务名覆盖旧来源记录。配置模式不接受额外的 `--ratio`、`--model`、`--text-model` 等业务 CLI 覆盖，避免两个地方都配置却不知道谁生效。

## 旧 jobs 格式仍可用

```bash
python3 scripts/generate-style-examples.py --jobs jobs.json --output output/gallery-generation/manual --stage rewrite --apply
```

`jobs.json` 是数组，每项包括稳定 `id`、source hash/slug 或完整快照、`character: {name,tag,traits}`，以及可选 `generation` 参数。旧任务的目录、ID 和续跑方式保持不变。新任务需要范围、多次生成或拆分配置时，优先用 `--config`；两个输入选项互斥。

## 中断、失败与重复运行

图片生成前会先核对整批新增任务是否超过账本剩余额度，再在每次提交时加锁预留。账本路径绑定在 `execution.json`：续跑省略 `--ledger` 会沿用原路径，显式切换会报错。不能通过删除账本或换文件名把已提交任务当成新任务。

- PixAI 已返回 task ID：只继续查询、下载，不再次提交生成。
- 已生成但下载或上传失败：重试原任务的下载或发布。
- 已明确失败：保留原始响应，计入尝试次数，不自动补生成。
- 提交中断且无 task ID：结果未知，先找回供应商记录，不推测它没收费。
- 文本 API 已返回但内容不合格：保存原响应；重跑只重新校验，不再次付费改写。未知文本提交也保留标记，需人工确认后另建尝试。

同一输出目录不允许两个 pipeline 进程同时运行。不同批次可以共用一个账本，预算预留会加锁。已经完成的图片仍会检查原始 SHA-256；文件损坏时要求恢复原文件，不自动生一张新图顶替。

如果 shell 中能 echo key，但 Python 看不到，检查变量是否 export。不要把 key 复制进配置或回执。计划阶段不需要 key；只改写需文本 key，只生图需 PixAI key，上传只读现有 HF 配置。

## 上传与回执

单份已有回执仍可独立发布：

```bash
npm run upload:generated-examples -- /absolute/path/receipt.json
npm run upload:generated-examples -- /absolute/path/receipt.json --apply
```

第一条验证格式与图片 hash。第二条核对线上 source 卡片和完整模板仍一致，再保存私有回执并上传原图、完整 note。不同卡片也会修改同一个 catalog 和 sub-gallery 索引，因此发布要顺序执行。pipeline 会用 checkout 内的共享锁串行上传；另开 checkout 或直接调用 Node 上传器时，也应避免并发发布。上传后读回核对；重复上传应为零新增。

`version: 1` 回执由 `src/lib/style-gallery-generation.ts` 验证：

| 字段 | 保存内容 |
| --- | --- |
| `id`、`createdAt` | 稳定生成任务 ID、UTC 时间 |
| `source` | slug、prompt ID、原模板 |
| `character` | 原名称、角色 tag、身份特征 |
| `rewrite` | 文本供应商、模型、完整请求与响应、改写 prompt |
| `generation` | 生图供应商、模型证据、task ID、实际完整 prompt、参数、原请求与响应 |
| `outputs` | 1–4 张本地原图路径、原始字节 SHA-256、从 0 起的输出顺序 |

原始 JSON 存入私有 `generation-receipts/v1/<source-slug>/<task-id>.json.gz`。同 ID 不可覆盖成不同内容。base64 图片可外置为原图文件并标明位置，其他字段保留；不保存 API key、cookie 或认证请求头。公开列表只读取展示所需字段，避免每次浏览都加载整份供应商 metadata。

请求参数与服务端报告分开保存。内置工具未报告模型版本时记为 `builtin-unspecified`，实际尺寸从文件读取；PixAI 请求中的 Tsubaki.3/helper 设置不能冒充响应已确认的实际参数。`paidQuota` 保留原字段名，不改称 credits，也不推算供应商未返回的费用。

sub-gallery 卡片的 note 保留三行。详情页 sub-image 的 note 最多显示五行，超过后在框内滚动。两处都有“生成图片 prompt”入口，点击后直接打开 Lightbox 并展开全文；如果点击的是图片，Lightbox 中的 prompt 默认折叠，点击“展开全文”即可阅读。深色阅读面板中的正文独立滚动，底部按钮复制完整生成文本；右侧工具栏原有的复制来源模板操作仍然保留。

这两条入口的布局与交互可用 `npx playwright test --config playwright.generation-notes.config.ts` 验证。测试在独立端口启动服务器，用只读的合成 HF 元数据检查三行、五行、全文复制、背景滚动隔离及窄屏边界，不需要真实凭据，也不会向 HF 写入。线上数据的真实性另由发布回读验证。
