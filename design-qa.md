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
