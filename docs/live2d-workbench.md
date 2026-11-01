# 多人物 Live2D 创作台

入口为 `/live2d-studio/index.html`，也可从博客「Live2D 工作室」顶部进入。独立页面不同时运行博客粒子、看板娘和 Gallery；原有弹窗继续支持 Bestdori，创作台目前只支持 Our Notes，最多三位人物。`?model=模型源ID` 可带入当前原生服装，但已有草稿优先，避免链接覆盖作品。

## 功能边界

- 人物按角色、服装分组，滚动逐批显示静态 WebP 缩略图，不启动额外模型。替换模型保留兼容的动作、表情、参数微调和构图，不强行套用缺失通道。
- 动作、表情、手动微调和关键帧分层合成，选择预设不清空手动微调。动作原始曲线可查看、隐藏和复制为编辑轨道。
- 画布支持拖动、滚轮缩放、文字尺寸手柄、图层排序/显隐/删除和一次手势一次撤销。输入框与批注拥有自己的快捷键。
- 滤镜是色彩、光照、质感和动效组合，预设与详细调整使用同一份状态。文字分为字体、颜色、效果、背景和位置五页，预览与导出共用绘制逻辑。
- 切换背景预设后仍保留上传素材。本地导出 PNG/JPEG/WebP、GIF，以及支持 H.264 WebCodecs 时的 MP4；可指定多个人物运动。GIF 固定调色板避免逐帧量化闪烁。格式预算见 `EXPORT_LIMITS`。
- 界面目前为中文，动作保留原始 ID 并提供中英文标签。侧栏可拖宽、折叠。不能将现有功能表述为完整复刻其他编辑器。

## 接力代码地图

源码位于 `public/live2d-studio/`，作为原生 ES modules 提供，不加入博客首页 bundle。不要只修改被忽略的 `.context/compound-engineering/` 样机：它不会部署。

| 文件 | 责任与约束 |
| --- | --- |
| `boot.js`、`model-catalog.js` | 启动错误/重试；标签快照与已发布目录取交集；仅走本站内容寻址资源接口 |
| `ui.js` | 工作流、控件绑定、草稿恢复及导出事务，不在这里实现 shader 或模型解析 |
| `engine.js`、`scene-engine.js` | 单人物 30 Hz 会话与多人组合；串行变更、旧请求取消、失败回滚及释放 |
| `compositor.js`、`effects.js`、`look-settings.js` | GPU 合成、独立动效时钟、归一化配方；预览/导出共用状态和时间输入 |
| `poster.js`、`poster-panel.js`、`text-inspector.js` | 文字绘制、图层交互和属性面板，不以 CSS 截图代替导出绘制 |
| `action-controls.js`、`keyframe-controls.js`、`pose-timeline.js` | 参数、原始/编辑曲线、插值；切换预设不清空手动微调层 |
| `range-controls.js` | 原生滑块数值与填色同步，约定见下节 |
| `editor-storage.js`、`asset-maintenance.js` | IndexedDB、撤销事务、素材引用检查及跨标签页协调 |
| `export-media.js`、`animation-preview.js` | 按需编码器、固定时刻采样、预算/取消；结束后还原预览 |
| `workspace-layout.js`、`studio-design.css` | 侧栏拖宽/折叠、分组缩进、窄屏布局 |

## 滑条同步约定

2026-11-02 的问题是赋值 `input.value` 不触发 `input`：滑块已移动，CSS `--range-progress` 仍显示上一图层或预设的值。

1. 程序更新控件一律用 `setControlValue(input, value)`。先赋值，再读 `valueAsNumber`；浏览器负责 clamp/step，填色使用实际值和 min/max，不直接使用未归一化业务参数。
2. 用户输入使用 `syncRange(input)`，新建控件组后使用 `refreshRanges(root)`。不要伪造输入事件，否则会重复写模型、历史及草稿。
3. 不重建正在拖动的 input，不全局改写原生 setter，不轮询 DOM。更新填色不抢焦点、滚动位置或指针捕获。
4. 按下到释放由 history hold/release 包成一个事务，中途停留超过保存 debounce 仍只需撤销一次。
5. disclosure 直属子项负责一层 12px 缩进；嵌套组保持可收缩宽度，不能用固定宽度撑出侧栏。
6. 后台标签页也必须完成新控件的一次初始化。`action-controls` 的 `updateLive(true)` 只用于重建后的首轮同步；日常帧更新继续遵守 `document.hidden`，不靠反复扫描所有滑条补救初始化。

新增滑条须验证初次显示、切图层、切预设、恢复、撤销/重做、负值范围、持续拖动与窄屏。审计包含折叠面板，不能只检查可见控件。

## 草稿和素材保护

IndexedDB `clelele-live2d-prototype`、schema 和应急草稿键保留原名，以兼容已有作品。不要为清理原型重命名或清空它们。存储与缓存按 origin 隔离，本地样机不会自动迁移到生产域名。

恢复完成前禁止保存半成品；失败保留当前画面。清理素材必须考虑当前文档、撤销/重做、预设、剪贴板及其他存活编辑器。无法完整确认引用或取得锁时跳过清理。`pagehide.persisted` 为真时，不销毁 BFCache 中仍会返回的模型。

调试用户页面前先备份最新草稿与批注，破坏性测试使用隔离上下文。刷新前再次核对最新图层，不能用早期备份覆盖后续编辑。`editor-events.js` 兼容原型批注的事件隔离；发布页不注入反馈桥。

## 性能与来源

贴图保留 HF 原图；适配器生成 mip 层并采用三线性采样，改善缩小边缘。显示人物各自持有一个必要模型会话，冻结人物复用画面，页面隐藏时停止连续绘制。暂停人物不等于暂停独立雨雪，动效有自己的开关。

模型缓存只存校验过的字节，目标上限 128 MiB / 512 项，不缓存解码模型或 GPU 会话，缓存失败退回普通请求。临时网络错误有界重试，换装取消旧加载。字体、模型及编码器按需加载，背景解码缓存最多三张。多人高分辨率导出仍可能耗时，帧率上限不是设备功耗承诺。

参考 sakiko.app 和 bdon 的公开交互，由本站独立实现，没有复制未明确授权的编辑器代码。沿用未修改的 `public/vendor/ournotes-player-0.1.8/` 和授权声明。字体、编码器许可证及来源见 `fonts/poster/`、`vendor/export/`；角色资源来源见[资源文档](live2d-our-notes.md)。

## 验证入口

```sh
npm run test:live2d
npx playwright test tests/live2d/workbench.spec.ts
npm run test:live2d:browser
npm run check
npm run build
```

浏览器测试使用真实本站目录和 HF 模型，需要已有代理环境，不要写入凭证。Playwright 使用独立端口和上下文，不读取用户草稿。测试与 Astro check/build 顺序执行，避免重建影响浏览器测量。

本轮还验证了 184 条动作曲线、微调叠加、文字尺寸手柄、650ms 停留后的单步撤销、背景/文字/动效状态往返、真实 GIF 编码、GIF→PNG 布局以及 1280px 桌面和 740px 窄屏。没有逐一人工审查全部模型及浏览器；修改相关工作流后须重测对应路径。
