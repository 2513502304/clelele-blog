# 从模板批量生成 sub-images

一张示例图需要能回答两件事：它用了哪个模板，以及生图时实际提交了什么。网页展示只需要图片、平台和完整生成 prompt；改写模型、角色设定、生成参数、请求与响应等信息另存私有 HF 回执，避免列表页每次加载一大包 API metadata。

## 四个独立步骤

1. 保存来源卡片的 slug、prompt variant ID 和完整模板，再列出角色的原名称、PixAI tag、发色眼睛等身份特征。
2. 文本 API 做小幅替换。默认 DeepSeek V4.1 Flash；角色与模板冲突的身份特征需要调整，环境、角度、画风、服饰和表情尽量原样保留。
3. 把改写结果分别交给生图平台。OpenAI 使用原角色名称，PixAI 只把名称换成对应 tag。PixAI 默认 Tsubaki.3、ultra、REST 1.5k、四张一批、随机种子、helper 关闭；参数可按任务更改。
4. 保存图片和回执，再单独上传到 blog。生成与上传分开后，上传失败不会重新花费生图 credits。

全局技能 `gallery-image-generation` 提供前面三个步骤的编排，复用官方 `imagegen` 和本地 `pixai-imagegen`。技能中的 CLI 默认 dry-run，加 `--apply` 才调用收费 API。每个平台的任务共用一份 ledger，包括子代理验收；提交前预留次数，网络超时也不会把次数退回后自动重发。

Codex 内置 imagegen 可以验证“在 Codex 中生图再上传”的流程。要脱离 Codex 独立运行 OpenAI API，仍需要 `OPENAI_API_KEY` 和相应 Python 环境。这两种验证不能混为一谈；内置工具没有报告具体版本时，不把用户想用的版本记成实际版本。

## 上传已有结果

```bash
npm run upload:generated-examples -- /absolute/path/receipt.json
npm run upload:generated-examples -- /absolute/path/receipt.json --apply
```

第一次命令检查回执格式和每张图片的 SHA-256，不写线上数据。第二次还会核对线上 source 卡片及模板是否仍与回执一致；通过后，先保存私有回执，再调用已有 sub-images 上传流程。note 是完整提交给生图模型的 prompt，保留换行。

回执的 `version` 固定为 1，字段由 `src/lib/style-gallery-generation.ts` 验证：

| 字段 | 内容 |
| --- | --- |
| `id`、`createdAt` | 稳定任务名、UTC 时间 |
| `source` | slug、prompt ID、原模板 |
| `character` | 原名称、PixAI tag、身份特征 |
| `rewrite` | 改写供应商、模型、完整 JSON 请求/响应、结果 prompt |
| `generation` | 生图供应商、实际模型或版本、task ID、完整 prompt、参数、JSON 请求/响应 |
| `outputs` | 1–4 张本地图片路径、原始字节 hash、从 0 起的输出顺序 |

HF 回执位于 `generation-receipts/v1/<source-slug>/<job-id>.json.gz`，在 Gallery 的私有命名空间内。相同 ID 只能对应相同内容；输入改变时必须新建任务 ID。回执不能含 API key、cookie 或请求头。完整供应商 JSON 只进入私有对象，公开图片路由无法读取它。

## 浏览生成 prompt

详情页和 sub-gallery 卡片默认显示 note 的三行。打开 lightbox 后，“展开全部生成图片 prompt”默认折叠；展开区域可以独立滚动，并复制全部文字。它与“复制源模板”是两个独立动作，避免把改写前后的 prompt 混淆。

## 失败时怎么继续

PixAI 已返回 task ID：继续查询同一任务并下载，不再提交生成。未返回 ID：结果不确定，停住这项，保留额度记录。生成成功但下载或上传失败：重试下载或上传已有结果，不换个任务名重新生成。

离线测试只能说明数据契约、任务预算和恢复流程成立。在线实验还需要可用的 API key、模型权限和真实回执；没有这些证据时，不能将结果记为“API 已验证”。
