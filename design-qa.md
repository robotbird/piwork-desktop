# 客户端对话界面设计检查

- 参考：用户提供的 piwork Web 截图（当前会话附件，原始尺寸 2984 × 1718）。
- 实现：Electron 开发版空对话窗口；在临时用户数据目录分别查看了浅色与深色界面。
- 已检查：侧栏层级、居中输入框、圆角、浅灰选中态、模型/技能/MCP 控件和 macOS 窗口空间。2026-11-04 在隔离数据目录再次检查浅色空对话窗口，截图暂存于 `/tmp/piwork-design-implementation.png`（2480 × 1640；临时文件可能被系统清理）。
- 有意差异：按用户最新要求，栏目顺序对齐 Web；MCP 为桌面保留入口，“我的文档”使用本地项目文件。测试窗口没有用户的真实项目与历史。
- 2026-11-04 初步并排查看：使用本机临时页面以各占半屏宽度显示参考图和客户端截图。两图原始比例分别约为 1.74 和 1.51；均为浅色空对话，但客户端没有项目、历史、账号及已配置模型，且有 macOS 窗口区域。因此该对照可确认栏目顺序和控件位置，不可据此判断精确间距、字号或整体比例。
- 初步观察：两侧均为左侧导航、中央输入框、输入框下方项目入口和右下角模型入口；桌面额外展示 MCP 和未配置模型提示。参考图为已登录、有多个项目和历史的状态，不能用客户端空数据状态对账号区和列表密度作最终验收。
- 待完成：需要匹配窗口内容尺寸和代表性数据状态，分别对完整画面及侧栏、输入框局部进行对照，再检查字体、色彩、间距和交互状态。当前模型入口仅展示已配置的自定义模型，真实账号模型列表尚未接入。不能据此宣布视觉验收通过。
- final result: blocked

## 2026-11-06 项目管理界面重构（对齐 Web 项目页）

- 参考：piwork Web `/projects/[projectId]` 页面（ProjectHome 组件）与用户提供的「创建项目/编辑项目」弹窗截图（多源文件夹 + 「主要」徽标 + 移除本地项目）。
- 实现：新建 `src/projects/project-home.tsx`（居中 max-w-3xl 列、头部更多操作、胶囊 composer、「聊天/来源」分段标签、聊天列表、来源=源文件夹管理）与 `src/projects/project-dialogs.tsx`（创建/编辑项目弹窗）；侧栏项目区对齐 Web 行样式并移除行内移除按钮；项目数据模型从单目录改为 `folders[]{path,label,main}`，全部源文件夹可读、仅主文件夹可写（写入仍逐次确认），Agent 工具路径采用 `源文件夹名/相对路径`。
- 已检查（Electron 构建版 + Playwright 截图，深色与浅色）：创建弹窗空状态/两文件夹态、编辑弹窗（主要徽标、添加文件夹行、移除本地项目/取消/保存）、项目主页聊天/来源标签、来源行 hover 操作（设为主要/在访达中显示/移除）均与参考一致，无重叠错乱；浅色无深色残留。截图暂存 `/tmp/piwork-visual/`（临时文件可能被系统清理）。
- 已知取舍：禁用态主按钮沿用全局 Button 样式（主色 + 50% 透明度）；「设为主要」为 hover 显示（行本身可点击设主）；空状态灰字对比度沿用 Web 同款 token。
- 回归：unit 82 项、desktop/project-agent/chat-interaction/mcp/schedule/office-security/sync/account e2e 与 metadata/migration/backup 冒烟全部通过。

## 2026-11-06 项目页严格对齐（补充轮）

- 参考：Web `/projects/[id]` 实际渲染页（DOM 量测对比）。修正差异：聊天行补第二行摘要（`summary ?? "—"`）与数字短日期（`11/6` 式，跨年带年份）；「更多操作」改为 Web 同款 outline 圆形按钮（细边框、40px）；composer 照搬 Web 自动增高（ResizeObserver、240px 封顶、单行/多行圆角切换与同款 grid 定位）；聊天/来源列表改 `mt-6` section + `flex flex-col`；修复全局 `header` CSS 污染项目页标题区（多余分隔线/58px 高）与附件菜单破坏 composer 网格行的问题。
- 数值比对（桌面 vs Web）：composer 704×56、textarea 598×40、标签 60×32、聊天行 79px（内边距 16/12、间距 16、标题 16/24/500、摘要 14/20 灰）、日期 14/20 灰 — 全部一致。
- 分享/项目成员为 Web 账号体系功能，桌面端无对应后端，未展示。
- 回归：unit 82 项、desktop-e2e、project-agent-e2e 全部通过。

## 2026-11-08 设置界面重构（对齐 macOS 系统设置参考图）

- 参考：用户提供的 macOS 系统设置风格截图（分组图标侧栏 + 搜索框 + 右侧大标题/副标题 + 行式列表）。
- 实现：新建 `src/settings.tsx`（SettingsPage，从 main.tsx 抽出）：侧栏加宽至 300px，新增搜索框（⌘F 聚焦、按标题/副标题/关键词过滤）与「账户/应用/关于」分组图标导航；右侧由锚点滚动改为按分区切换页面（general/account/gateway/plugins/about），每页 28px 标题 + 副标题；通用页为 divide-y 行卡片（外观 PaintbrushIcon + 分段控件、语言 GlobeIcon + 下拉，行内直接生效，用户确认不走箭头二级页）；网关表单迁移至组件内（Input/Switch/Button 重构，弃用 .gateway-form 遗留 CSS）；account.tsx/sync-settings.tsx 重写为 Tailwind 卡片样式（逻辑与可访问名不变，同步开关改 Switch）；新增「关于 PiWork」页（PiLogo + app:version IPC 版本号）；「配置模型…」入口直达模型网关分区。
- 已检查（Electron 构建版 + Playwright 截图，浅色与深色 × 5 分区 + 搜索态，暂存 `/tmp/piwork-settings-visual/`）：侧栏分组/图标/选中药丸/搜索徽章、通用页行卡片与行内控件、网关表单分割线与输入框对齐（视觉初审误报缺线/错位，二次精确复核排除）、账号页双卡片、深色无浅色残留、无重叠溢出。
- 已知取舍：描述文字/分组标题沿用全局 muted token（与主应用一致，未单独加深）；参考图行高约 110px 因行内控件改为 py-5 紧凑行；「关于」页为最小信息（名称/版本/简介），未加更新检查等新功能。
- 回归：`pnpm build`（tsc + vite）、unit 92 项、account-e2e、sync-desktop-e2e 通过（两者各加一步点击侧栏「Account & sync」导航）。desktop-e2e 在第 39 行 `.preview-file-list` 文件夹点击处超时失败：已用不经过设置页的最小复现脚本确认为 preview dock 既有问题（点击文件后列表面板折叠为 0×0），与本次设置页改动无关，待单独修复。

## 2026-11-10 权限确认与 Agent 提问交互卡片

本节仅验收本次「输入框上方提示」改造，不覆盖前述历史验收范围。

**参考与证据**

- 用户图 1：`/var/folders/9b/8y0kwpzj4h1_wzryl7kzmbfm0000gn/T/codex-clipboard-77e28fc8-290d-4a10-b0d4-300bff03b8df.png`，原图 2466×1660，作为旧权限遮罩弹窗的行为参考。
- 用户图 2：`/var/folders/9b/8y0kwpzj4h1_wzryl7kzmbfm0000gn/T/codex-clipboard-d189236f-808f-4706-9141-d30447a86fdd.png`，1608×634，作为输入框上方提问卡片的交互参考。
- 实现：`apps/desktop/src/chat/pending-interactions.tsx` 与同名 CSS；通过实际生产构建渲染，本地预览使用模拟 Desktop API，未连接真实模型或执行命令。
- 完整实现截图：`.visual-tmp/question-card-dark.png`（1280×800）、`.visual-tmp/permission-card-dark.png`（1280×800）。
- 深色提问局部：`.visual-tmp/question-card-dark-detail.png`（768×417）；浅色最小窗口：`.visual-tmp/question-card-light-small.png`（800×600）；窄列压力检查：`.visual-tmp/question-card-light-narrow.png`（680×700，卡片宽 388 CSS px）。
- 同图对照证据：`.visual-tmp/interaction-reference-comparison.png`；聚焦卡片对照：`.visual-tmp/interaction-reference-detail.png`。已实际打开这两张组合图进行比较。
- 比较状态：同一问题、相同选项、未选择、第一页（共两题）、深色。源图按 2×密度归一到 804×317，实际截图为 1×，CSS 视口 1280×800；聚焦比较另将源卡片等比归一到 768 px 宽。源图仅含底部区域，因此对照范围为提示卡片和输入框，不推断整窗布局一致。

**检查结果**

- 字体与层级：沿用 PiWork 的 Geist 与系统中文字体，提问 15px、选项 13px、辅助说明 11–12px；标题、编号、描述层级清楚，长问题和回复可换行。
- 间距与布局：卡片与输入框等宽、间隔 10px，卡片采用 24px 圆角，窄列改为 18px。顶部问题翻页、关闭按钮和底部操作位置符合参考结构。388px 窄列下自填回复与按钮分行，按钮未截断，无横向溢出。
- 色彩与状态：复用 card、foreground、muted、hairline 等现有 token，深浅主题均已截图。选中态有勾选标记，未选时继续按钮禁用，键盘焦点可见。
- 图像与图标：此流程无图片素材；使用项目已有 Lucide 图标，未用自绘图形代替标准控件图标。
- 文案与行为：权限展示实际工作目录和解码后的多行命令，支持展开完整参数；提供允许一次、项目内始终允许（有项目时）、完全访问与拒绝。关闭权限卡片按拒绝处理。问题支持选项、自填、多题往返、跳过和提交；关闭整组问题返回 cancelled，跳过返回 null。
- 允许的产品差异：用户要求参考交互方式，保留 PiWork 现有多行输入框、蓝色主操作、权限菜单和模型菜单；不复制 Codex 的模型名或语音按钮。卡片留白与主输入框高度沿用本产品布局，未做逐像素复刻。

**比较历史与修复**

1. 首轮发现：权限卡片重复标题和过高的命令预览使选项在常见窗口高度下需要过多滚动（P2）。修复：标题合并到卡片头部，默认代码预览缩为 54px，整体高度限制改为 62dvh，正文可独立滚动、底部操作保持可见。后续截图 `permission-card-dark.png` 显示默认状态所有权限选项和操作均可见。
2. 多页面检查发现：在技能页与聊天页之间切换会重新挂载卡片，需保护已填答案（P2）。修复：按请求 ID 缓存当前页和答案；实测在第二题输入自填回复，切换技能页再返回，页码、文字和第一题选项均保留。
3. 稳定构建后的组合图复核：无本次范围内仍需修复的 P0/P1/P2 视觉问题。旧构建预览期间曾因动态分块被新构建替换而出现一次模块加载失败；最终构建完成后重载已恢复，之后测试未出现新控制台错误。

**交互与验证**

- 浏览器实测：默认禁用继续、选择与自填、前后翻页保留答案、跳过覆盖旧选择、提交后恢复聊天、多请求排队、关闭提问后显示下一项权限、允许一次、拒绝、跨页面保留答案；检查了深色、浅色、最小桌面窗口和窄列。
- `pnpm --dir apps/desktop build`：通过（含 TypeScript 检查）。
- `node --test tests/*.test.mjs`：114/114 通过。
- `apps/desktop/node_modules/.bin/electron tests/question-worker-smoke.mjs`：真实 Electron utilityProcess 的提问、回答、关闭、停止及停止后继续通过。
- 相关新增用例覆盖：提问回复校验、重复 ID/重复选项拒绝、等待用户后继续、取消语义、后台任务不注册 ask_user。
- 验证边界：界面验收使用模拟 Desktop API；真实工作进程链路另行测试。本次未运行完整桌面 UI 自动化套件或真实云模型调用。

**Implementation Checklist**

- [x] 权限弹窗迁移到输入框上方，去掉遮罩和焦点锁定。
- [x] Agent 提问工具及 worker/main/preload/renderer 通道接通。
- [x] 多问题导航、答案缓存、跳过、取消与并发排队可用。
- [x] 构建、单元测试、Electron 工作进程测试与截图核对通过。

final result: passed
