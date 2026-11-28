# Hpoi 本人收藏购买信息

## 当前结论与入口

购买资料集成在现有 `/hpoi/admin` 的「查看本人购买信息」面板。页面及 API 均沿用站点 GitHub owner 身份校验；非 owner 无法读取。面板通过动态 import 在点击后载入，普通 `/hpoi` 收藏页不请求购买 API、不下载购买组件。打开面板只读取已保存的私有快照；点击刷新才访问 Hpoi。

面板提供真实的 [Hpoi 官网登录](https://www.hpoi.net/user/login) 入口，可在官网完成其扫码登录。该登录只服务于 Hpoi 本站，与博客同步配置分别展示；博客不会嵌入或转发官网二维码，也不接收扫码确认后的浏览器 Cookie 充当第三方授权。目前没有接入官方委托授权，须等待正式集成资料。未建立博客同步连接时，仍可读取已有私有快照。

这是本人在收藏表单里填写的购买资料，不是商城订单或完整历史交易流水。当前已验证的表单提供状态、购买时间、渠道、金额、币种、购买方式、标签和备注。金额保留十进制字符串，空金额显示「未填写」，不会当作零，也不合计不同币种。记录按收藏记录 ID 保存与展示，相同商品的不同记录不合并；若 Hpoi 的当前表单只暴露一次记录，本实现不会推测或补造未返回的历史入手记录。

## 经过验证的 ID 与读取路径

三个数字属于不同命名空间，不能互换：

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `figureId` | 本人收藏列表真实链接 `/hobby/{figureId}` | 公开商品页面 |
| `itemId` | 该商品页的 `/album/new?itemType=hobby&itemId=…`、`/modal/hobby/republic?itemId=…` 与 `fn.init(fn, itemId, figureId)` | 读取已有收藏表单 |
| `collectionId` | 返回表单的 hidden `id` | 本人的收藏记录身份 |

同步顺序为本人收藏列表、真实商品详情、`POST /collect/hobby/get/{itemId}`。最后一个 POST 只读取现有编辑表单；代码从不调用修改端点 `/collect/hobby/add`。`itemId` 必须与表单 hidden `itemId` 一致，商品页若给出多个内部 ID 来源也必须一致。没有任何枚举或猜测 ID 的路径，浏览器 API 也不接受客户端提交商品 ID、来源 URL 或账户。

每次手动启动或继续任务，首先读取 `/user/home`，只信任 `ul.hpoi-navpersonal` 已登录个人菜单里的精确 `/user/{uid}` 链接，以及「我的收藏」链接中的相同 UID。它们必须同时等于站点已配置的 Hpoi UID；其他用户的公开资料链接不能证明登录身份。首屏收藏页与商品详情也检查该菜单。Cookie 不跟随重定向，仅发送到固定的 Hpoi HTTPS 源站。

## 私有配置

复用已有 GitHub owner 登录和 HF S3 客户端，不引入新的服务或依赖。购买对象必须使用独立私有 bucket，不能复用公开 Gallery bucket。运行时需要：

- `HPOI_PURCHASES_COOKIE`：经过授权的本人 Hpoi 会话，仅通过服务器 Secret/私有环境注入。不要放入仓库、业务对象、浏览器存储或公共环境变量。
- 现有 `HF_S3_ACCESS_KEY_ID`、`HF_S3_SECRET_ACCESS_KEY`（兼容既有 AWS 命名回退）、`HF_S3_ENDPOINT`，可选 `HF_S3_REGION`。
- `HPOI_PURCHASES_BUCKET`：明确绑定独立的私有 bucket，没有 `HF_S3_BUCKET` 或默认值回退；代码拒绝默认公开 bucket `raw-datasets` 和与 `HF_S3_BUCKET` 相同的 bucket。
- 已为部署绑定独立 `hpoi-purchases-private`，通过官方元数据确认 `private:true` 且匿名读取返回 401。现有 Gallery 默认 bucket 已查明为公开，绝不能存放明文购买资料。若更换绑定，须先核验新 bucket 的私有属性及 IAM 范围；独立名称本身不会替代实际 ACL 核验。

对象固定存放在独立私有 bucket 的隔离前缀 `hpoi-private-purchases`，再以源账户的 SHA-256 命名；不使用 Gallery 公开 bucket 或数据前缀，也不返回对象地址或签名 URL。现有 Gallery 单图/批量签名接口只允许图片键，Hpoi 图片代理也只接受 hash 图片键，均无法读取这里的 JSON 或通过路径穿越跨入此前缀。购买 API 所有响应均为 `private, no-store`，不进入 CDN 缓存；管理员页面另设 `noindex`。

`cloudflare/container-worker.mjs` 允许将上述 bucket 名，以及可选的服务器会话 Secret 传入容器；`wrangler.container.jsonc` 只配置非密 bucket 名。当前无需配置 Hpoi 会话即可查看一次性本地同步留下的私有快照；本次登录态不持久化，也不部署为 Cookie Secret。容器启动后保留当时的环境，更改 binding 后需让新配置在容器下次启动时生效，参见 [Cloudflare Containers 官方说明](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)。

没有会话时仍可读取已保存快照，但不能刷新。没有确认私有存储时面板显示配置提示。会话过期、登录了其他账号、出现验证码、HTTP 错误、表单缺字段或 ID 不符时会停止，保留上一份完整快照，不把坏响应写成空结果。代码和测试不包含真实 Cookie、个人内部 ID 或购买字段样本；本功能不会自动设置生产 Secret。

## 有界任务与恢复

没有发现可复用的官方购买资料 batch API。现有 HTML 列表分页有明确页数，沿用其 GET 首屏与 POST 分页参数，每次 API 调用最多推进三步，所有 Hpoi 读取共享 20 秒期限，单次读取另限 10 秒与 2 MB。列表限制 100 页、10,000 个商品，私有检查点限制 8 MB，超限会暂停而不截断发布。

每页发现和每条成功读取均保存 durable 检查点。上一次完整快照与进行中记录分开保存，只有所有页和所有记录完成后才原子替换。HF ETag 条件写入保护并发更新，60 秒租约阻止多个窗口重复领取；写入确认丢失时先读回 revision。关闭面板会停止浏览器后续请求，服务器已开始的一小段仍可完成检查点；稍后点击「继续同步」会接着任务处理。失败不会自动后台重试，也不自动刷新 Hpoi。

若源列表在长时间同步中改变，本次结果仍是逐页读取的快照，不具备上游事务一致性；需要重新完成一次刷新以反映后续变动。若进行中的条目被移出收藏，或希望重新发现列表，可点击「重新开始同步」；它只重建匹配的未运行任务，保留上一次完整快照，并拒绝覆盖其他窗口正在推进的任务。分页元数据缺失、非空页数却返回空条目时拒绝发布。

## 公开资料核查

[RSSHub 的 Hpoi 用户动态实现](https://github.com/DIYgod/RSSHub/blob/6fab80821964d661f0f05f5bf45bf535152f841b/lib/routes/hpoi/user.ts)只从公开收藏列表提取名称、图片和展示文本，没有购买表单、完整分页或 batch 导出。[Hpoi 隐私政策](https://www.hpoi.net/privacy)第九条列明本人可查阅收藏、订单和账单记录，并可联系平台获取无法查阅的内容，但未承诺 CSV/Excel 导出或公开 API。这些资料不能用来证明未测试的购买字段或历史记录完整性。

## 验证

- `node --import tsx --test src/lib/hpoi/*.test.ts`：公开功能回归，以及购买解析、精度、身份校验、真实入口发现、缓存隔离、CAS、写入读回、并发租约和断点恢复。
- `node node_modules/@playwright/test/cli.js test --config playwright.hpoi-purchases.config.ts`：仅本地合成登录，校验 owner gate、跨源拦截、访客零新增购买请求、点击懒加载、失败保留快照、未填写金额、无浏览器持久化和窄屏布局。
- `node node_modules/astro/astro.js check`、`DEPLOY_TARGET=cloudflare-container node node_modules/astro/astro.js build`，以及改动路径的 Biome 检查。

本地浏览器测试使用合成数据并拦截购买请求，不访问真实 Hpoi 会话。已由授权会话持有者使用实际 source 对指定本人样本完成个人菜单校验、列表发现、内部 ID 与独立收藏 ID 读取，核对状态、购买时间、渠道、金额币种和入手形式与原界面一致，金额精度核对通过。本次会话没有持久化；生产启用仍需要另行授权的私有环境配置和本人运行后的验收。
