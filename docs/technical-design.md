# piwork Desktop MVP 技术设计

- 版本：V0.2；更新：2026-11-03
- 范围：桌面端当前实现、目标边界、构建与交付；产品要求见 [MVP 需求](mvp-prd.md)，任务状态以 [详细开发计划](development-plan.md) 为准。
- 状态约定：本文明确区分**当前实现**和**待设计/验收**；当前实现不表示整个 MVP 已完成。客户端功能与交互以 piwork Web 为参照，桌面技术栈和打包方式参考 skillkit。

## 1. 技术选型与现状

| 层次 | 当前实现 | 后续工作 |
| --- | --- | --- |
| 桌面宿主 | Electron；`BrowserWindow` 使用 `hiddenInset`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` | 安全配置、目标 macOS 版本和窗口行为继续验收 |
| 界面 | React 19、TypeScript、Vite；普通 CSS 和组件内中英文字典 | 统一国际化、可访问性、设计规范和响应式验收；当前未使用 Tailwind/Radix |
| 进程通信 | preload + `contextBridge`，类型定义在 `shared/types.ts`；主进程核对发送者及主框架 | 继续覆盖参数、异常和跨进程生命周期 |
| 应用元数据 | `userData/settings.json`，串行写入临时文件后重命名 | 当前不是 SQLite，也没有版本化迁移或损坏恢复；后续目标见 [本地存储设计](local-storage-design.md)；独立 SQLite 访问、迁移与备份原型未接入，首版本地闭环继续使用 JSON |
| 凭据 | 单个自定义网关的 API Key 使用 Electron `safeStorage` 加密，密文存于 `gateway.json` | 账号使用独立 Chromium 会话分区；MCP 凭据尚未实现 |
| Agent | Pi Coding Agent SDK 1.5.0，Electron `utilityProcess` 中执行 | 当前不是 Pi RPC 或 Durable；项目内文本文件操作已接入，完整中断恢复尚未完成 |
| 预览 | PDF.js、docx-preview、@office-kit/xlsx、@office-kit/pptx 和 @office-kit/pptx-preview | 中文、表格、图片、异常文件、许可和打包环境验收仍未完成 |
| 打包 | electron-builder 26.15.3，macOS ARM64 `.app`、DMG 和 ZIP | 安装、升级、打包后功能、最低系统版本及 CI/Release 未完成验收 |
| 更新 | 无自动更新实现 | 先验证手动安装升级和数据保留，再评估自动更新 |

**版本实测（本机当前安装）**：Electron 45.2.1 内置 Node 24.22.1；安装的 `@earendil-works/pi-coding-agent` 1.5.0 声明 Node `>=22.19.0`。本机 macOS 26.6 上完成模拟网关、窗口及打包基础验证；这不能推导所有原生依赖或 macOS 13 均已实测。已选 better-sqlite3 13.0.3、实际加载 SQLite 3.53.4，并通过临时库 WAL 和 ARM64 打包测试；应用元数据尚未迁移。根目录 `packageManager` 声明为 pnpm 10.32.1，实际使用的 pnpm 及依赖以本机和锁文件为准。所有直接使用的 Pi 包锁定到同一版本。

## 2. 进程与职责

```text
React Renderer
  对话 / 项目 / 文件预览 / 技能 / MCP / 本机定时 / 设置
      │ window.desktop：可序列化的类型化请求与事件
      ▼
Electron Preload (contextBridge)
      │ IPC
      ▼
Electron Main
  窗口、文件选择与读取、配置、凭据、任务索引、定时和工作进程
      │ Electron utilityProcess / 消息
      ▼
Pi Coding Agent Worker
  ModelRuntime + AgentSession + SessionManager + 显式技能 / MCP 扩展
      └── 用户配置的 OpenAI 兼容网关
```

- 渲染进程不直接持有 Node 或 Pi SDK。主进程校验 IPC 发送者及输入，处理窗口、系统对话框与文件操作；创建项目在「创建项目」弹窗中完成：填写名称后通过系统目录选择器（多选）添加源文件夹，第一个为主文件夹，取消不会保存项目；编辑弹窗可改名、增删源文件夹、切换主文件夹并移除本地项目。新窗口创建被拒绝，生产导航仅允许应用入口；生产构建配置 CSP。详见 [E08 检查记录](release-security-audit.md)。
- 当前前台对话在一个工作进程中运行，定时任务各自启动工作进程。进程隔离用于生命周期和稳定性，不等于操作系统安全沙箱。
- 普通对话提供文本增量、完成/失败/停止及工具开始和结束状态；MCP 与项目写入另有确认请求。历史工具状态来自 Pi 会话记录；当前事件没有完整 Run ID、顺序重放或详细输出，不能视为完整运行协议。
- XLSX 和 PPTX 在浏览器 Worker 中解析，DOCX 使用受限制 iframe 渲染，PDF 使用 PDF.js；具体安全性与目标样例仍需专项验收。

### 2.1 Pi 会话和工具边界

- 当前通过官方 `createAgentSession()`、`ModelRuntime`、`SessionManager` 和 `DefaultResourceLoader` 创建会话，`SessionManager` 的 JSONL 是恢复模型上下文的权威来源；应用索引不代替 Pi 会话。
- 默认禁用自动发现的扩展和上下文文件。用户显式选择技能后，通过 Pi 加载技能说明，并提供所选技能目录的有限文本读取；脚本命令使用 Pi Bash 工具，在本机执行前逐次确认，不提供操作系统沙箱。未选择技能时不启用该命令工具。
- 用户选择已配置 MCP 时，使用官方 `createMcpExtension()` 和 `session.bindExtensions()` 注册直接工具；每次 MCP 工具调用经 Pi `tool_call` 钩子请求单次确认，拒绝、超时或取消时阻止本次调用。Pi MCP 原文服务器日志当前丢弃到 `/dev/null`，不控制外部服务自己的日志；MCP 服务进程启动本身可在本机执行，**没有 OS 沙箱保证**；目前不支持 MCP 凭据/环境变量管理和 OAuth。
- 项目文本附件是用户主动选择后由主进程读取并纳入提示词；关联项目后，Agent 可通过 Pi 自定义工具列出目录、读取 UTF-8 文本、PDF/DOCX 文字、XLSX 单元格和 PPTX 文本；经用户明确启用视觉能力后可读取图片。项目可有多个源文件夹：`project_list` 根层列出源文件夹（首个为主文件夹），路径形如 `源文件夹名/相对路径`，裸相对路径解析到主文件夹；读取对所有源文件夹开放，`project_write` 与 `project_create_office` 仅允许写入主文件夹并显式拒绝其他文件夹。确认后可创建或替换文本文件，以及创建 DOCX/XLSX/PPTX 新文件；扫描版 PDF 的 OCR 和已有 Office 文件的原位编辑尚未实现；目录越界和符号链接被拒绝，写入前检查文件是否发生变化。此路径检查不等于操作系统沙箱，也不能保证应对所有并发路径替换。
- Gondolin 的打包、挂载、网络和 MCP 隔离按既定决定后续考虑；未验证的边界不得标为已实现。Pi Durable 未作为当前主引擎，其与 Coding Agent 的扩展和会话兼容性未被假定。

### 2.2 当前目录

```text
piwork-desktop/
├── apps/desktop/
│   ├── electron/       # Main、preload、Pi worker、文件/项目/调度逻辑
│   ├── src/            # React、CSS、Office 预览及浏览器 Worker
│   ├── shared/         # IPC 类型
│   ├── dist/           # 构建产物，忽略
│   ├── dist-electron/  # 构建产物，忽略
│   └── release/        # 本地安装包，忽略
├── docs/               # 需求、设计、计划与历史记录
├── tests/              # Node 测试、Electron 窗口测试及 fixture
├── prototype/          # 视觉原型
├── pnpm-workspace.yaml
└── package.json
```

当前没有客户端专用 `.github/workflows/`、`packages/` 或独立安装脚本；应用已配置本地图标资源。

## 3. 数据、隐私与当前限制

| 数据 | 当前存放及行为 |
| --- | --- |
| 设置、项目、对话索引、技能/MCP 元数据、计划及运行记录 | `app.getPath('userData')/settings.json`；主进程序列化写入，临时文件再重命名 |
| 自定义网关 | `gateway.json` 存地址、模型 ID 及可选加密 API Key；当前只支持一个配置 |
| Pi 会话 | `userData/sessions/<id>.jsonl`；删除对话时将会话文件移入 `sessions-trash/` 并移除索引 |
| 项目目录 | 本机用户目录（每项目一个或多个源文件夹，其一为主文件夹），不因创建项目或同步自动上传；源文件夹集合变化后已有对话保留创建时的路径快照（`projectPath` 主路径 + `projectFolders` 全量列表） |
| 技能/MCP | 本机配置；技能源文件保留在导入位置。MCP 配置无凭据能力 |

MCP 连接测试使用 Pi MCP 客户端在独立进程中连接 stdio 或无认证 Streamable HTTP 服务，读取工具名称和描述后关闭连接；超时或失败时仅显示通用提示。测试成功不表示连接持续在线。工具调用前逐次确认；stdio 服务在本机用户权限下运行，不受操作系统沙箱保护。
| 定时运行 | 本机应用运行时调度；记录计划、执行状态和关联对话，上次未结束时跳过 |

- 目前应用使用的 JSON 元数据没有 schema 版本，也未实现迁移、备份或损坏修复。启动读取出错不会被描述为已完成自动恢复；目标采用 SQLite 的设计见 [E07 本地存储设计](local-storage-design.md)；E10 的独立访问层已实现但尚未接入；迁移尚未实现，当前 JSON 仍是权威元数据。
- 对话关联项目后，Agent 可读取项目文本、PDF/Office 文字，以及在视觉能力启用时读取图片，并发送至所选模型网关，界面在发送前提示；项目不会被整体上传。当前支持单个 64 KB 以内的文本附件，Office、图片和多附件发送尚未接入。
- 网关 API Key 使用 `safeStorage`，其可用性依赖运行环境；账号使用 Web 登录 Cookie，不向渲染进程暴露；当前不支持 MCP 密钥。不要将凭据写入日志或同步数据。
- 账号复用 Web 会话及 `/api/models` 目录；桌面通过仅监听回环地址且带随机凭据的进程内转发连接 Web Pi 消息流代理，服务端逐次检查模型权限和额度并记录用量。历史同步已接入，并通过真实账号的基本双向续接测试；离线启动和部分同步管理仍待完成。本地项目文件、技能及 MCP 不会因历史同步自动迁移。

## 4. 本机调度与异常

- 计划使用五字段 Cron 和指定时区；调度循环仅在应用运行时工作。重启时过期计划记录为错过、不自动补跑；运行重叠记录跳过。定时任务使用所选项目、技能和 MCP；写入与工具调用需用户确认，最长等待两分钟。
- 计划绑定创建/编辑时的网关 URL 与模型 ID；配置变化时执行失败，避免静默转向其他模型。当前不是多网关选择方案。
- 定时工作进程有 30 分钟执行期限，应用重启时将先前运行中的记录标为失败；自动触发、休眠、异常恢复及用户可读错误仍需完整验收。
- 前台任务异常恢复、带副作用操作的恢复与并发写冲突策略尚未实现。停止和用户确认不能证明外部副作用恰好执行一次。

## 5. 文件预览与成果

| 格式/操作 | 当前能力与限制 |
| --- | --- |
| 文本、常见代码 | 只读文本预览，最多 1 MB；用户可显式选择不超过 64 KB 的项目文本发送 |
| 图片 | PNG/JPEG/GIF/WebP 只读预览，最多 10 MB |
| PDF、DOCX、XLSX、PPTX | 本地基础预览，文件最多 20 MB；中文、表格及图片的基础样例已在开发版和 ARM64 打包版验证，复杂格式不保证还原 |
| 手动保存 | 用户可将助手回复保存为项目内新 Markdown 文件，并预览；排他创建不覆盖已有文件 |
| 系统操作 | 用户可从预览打开文件或在访达定位；不支持预览的文件也有入口 |

项目文件操作检查相对路径并排除符号链接，但该检查未覆盖所有并发文件系统替换情形，不应表述为安全沙箱。Office 渲染不保证复杂图表、动画、特殊字体或公式重算；XLSX 图片在独立区域显示，不保证其原有位置。

## 6. 开发、验证和 macOS 打包

当前根目录可用命令：

```sh
pnpm install
pnpm setup:electron
pnpm dev
pnpm build
pnpm test
pnpm test:desktop
pnpm test:metadata
pnpm pack:mac
pnpm dist:mac
```

`pnpm rebuild:electron` 为当前 Electron 重新编译原生模块；`pack:mac` 构建 ARM64 应用目录；`dist:mac` 构建 ARM64 DMG 和 ZIP，产物位于 `apps/desktop/release/`。electron-builder 的 appId 为 `net.piwork.desktop`，使用 `build/icon.icns`，macOS `identity` 配置为 `null`，最低目标为 macOS 13，不发布 Intel 包。Apple 开发者签名和公证按用户决定暂不考虑。

在 macOS 26 ARM64 完成了隔离目录下的 DMG 挂载、同版本两次构建间替换、配置及会话保留测试，并验证打包后的 Pi、Office 与 MCP 基础流程；相关模拟服务与选择器不等于真实服务验收。macOS 13、实际跨版本升级及正式分发许可仍待验收。

参考 skillkit 的 GitHub Actions / Release 和更新方式属于后续工作；当前客户端没有对应 CI、发布或自动更新实现。不能因本地生成 ZIP/blockmap 就宣称更新可用。

## 7. 待决策与交付门槛

- 首个本地可用版本以[精简开发计划](development-plan.md)中的项目、网关、办公文件任务、预览、技能、MCP、定时和基本数据保留为准。当前 JSON 继续作为权威元数据，SQLite 迁移及完整备份恢复留待后续；已有原型不代表应用已启用。
- Pi 文件读取和写入需先核对安装版本的官方工具、扩展和事件接口；写入前需用户确认，不将路径检查描述为操作系统沙箱。
- 使用含中文、表格和图片的三类 Office 样例完成基础预览验证；复杂格式不要求完整还原。
- 账号已接入 Web 登录、模型目录和流式模型代理；本地数据库已应用用量迁移，其他部署需执行该迁移。历史同步已通过真实账号的基本双向联调，仍需完成离线启动策略和同步管理。
- 在目标 ARM64 设备验证安装、升级及数据保留；签名和公证暂不考虑。

## 8. 依据

- 当前实现：`apps/desktop/electron/`、`apps/desktop/src/`、`apps/desktop/shared/types.ts`、`apps/desktop/package.json`、根 `package.json` 和锁文件。
- 测试与状态：[详细开发计划](development-plan.md)、[历史开发记录](development-history.md)、`tests/`。
- 对照项目：skillkit 的 Electron/Vite、electron-builder 和发布工作流；piwork 的运行时协议及 Web 设计。
- Pi 官方：[SDK](https://pi.dev/docs/latest/sdk) · [扩展](https://pi.dev/docs/latest/extensions) · [隔离](https://pi.dev/docs/latest/containerization)。以已安装版本源码和类型为优先核对依据。

## 9. MVP-15 同步实现（进行中）

- 桌面复用 Web `/api/history` 和 `/api/messages` 查看普通对话，并可通过 Pi `SessionManager.appendMessage` 导入为本地副本；副本与 Web 原对话独立，不导入附件、工具内容及项目资料。
- 经用户确认，Web 增加使用现有登录认证的最小同步接口和运行互斥状态；桌面仅将用户原文和最终助手文本写入持久队列，采用前缀比对检测冲突，并通过 Pi SessionManager 将 Web 增量追加到同一会话。离线待发送记录保留，不重跑任务。
- 对同一同步对话，Web 与桌面执行前持有互斥状态，状态不确定时不会自动接管。已在隔离数据库验证鉴权、文本范围、冲突和互斥，并用桌面模拟服务验证双向文本与重启。
- Web 需应用 `0026_desktop_sync_state` 迁移并设置 `PIWORK_DESKTOP_SYNC_ENABLED=1`；桌面用户须在设置中主动启用同步。本机测试数据库已应用迁移，现有 3000 端口服务未开启同步开关。
- 意外中断后需用户明确确认旧任务和其启动的进程停止，才会解除互斥并同步已记录输入；不会自动重跑，未完成的回复保留在本地。真实账号和模型已通过独立 Web 进程完成双向续接测试。标题变更、运行终态、删除流程和离线启动策略仍待完成；不得将 MVP-15 标记为完成。
