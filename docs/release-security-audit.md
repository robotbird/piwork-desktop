# 发布前依赖与安全检查（E08）

- 检查日期：2026-11-03；对象：当前锁文件、源码及本机生成的 macOS ARM64 应用。
- 结果：**部分完成，尚未达到发布验收**。依赖分发许可文本、完整安全/日志及目标 macOS 版本验收仍需完成。
- 此文档是工程检查记录，不是法律意见、安全认证或对未测试场景的保证。

## 1. 依赖许可

运行 `pnpm licenses list --prod --json` 对当前生产依赖图生成 [初步清单](third-party-licenses.md)：161 个包名条目。该清单基于安装包元数据，不等同最终分发物料清单，未完成逐项版权、许可、通知与源码义务审核。

- 主要组件声明：Pi Coding Agent 1.5.0、better-sqlite3 13.0.3、@office-kit/xlsx 0.25.0、@office-kit/pptx 0.28.0、@office-kit/pptx-preview 0.21.0 为 MIT；docx-preview 0.3.6、pdfjs-dist 4.10.38 为 Apache-2.0。
- **已处理原问题**：XLSX 解析已由 ExcelJS 切换为 `@office-kit/xlsx` 0.25.0；`buffers@0.1.1` 不再出现在生产依赖图或当前 asar 中。中文、多工作表、数字格式和已保存公式结果有基础回归；完整 Office 样例与异常文件验收仍属 F08/F13。
- `@resvg/resvg-js` 及其 ARM64 包声明 MPL-2.0；JSZip 声明 MIT 或 GPL-3.0-or-later。具体分发条件、选择适用许可及完整第三方通知尚需核对和落实。已检查 asar 中 docx-preview、resvg 可见各自 LICENSE，不能据此认定所有许可义务已满足。
- 本地扫描发现 22 个包的安装目录缺少常见许可证/通知文件名（不等同无许可）；其中 8 个 Pi 包已核对官方 v1.5.0 根许可证，另 4 个已依据 npm gitHead 核对上游许可证；这 12 个仍需纳入分发通知，其余 10 个待查，具体见 [待核实清单](third-party-license-missing.md)。需核对对应版本的上游文本、Electron/Chromium 分发声明、asar/unpacked 内容与第三方通知。

## 2. 依赖安全与原生模块

- 替换 ExcelJS 并安装 SQLite 后，`pnpm audit --prod --json` 报告 0 严重、0 高、0 中、0 低；这是当前依赖图的时间点结果，不代表源码、Electron 本体或发布物不存在漏洞。
- 先前扫描中的 `uuid@8.3.2`（[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)）及 `minimatch@3.1.5/5.1.9`（[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)）随 ExcelJS 移出当前生产依赖图；本次没有使用跨主版本强制覆盖。
- 原安装 Electron **37.10.3**，官方发布计划列出 Electron 37 于 2026-01-15 结束支持。现已按用户选择升级至 Electron 45.2.1（内置 Node 24.22.1）；当前 macOS 26.6 通过 Pi 模拟网关、窗口与打包预览验证，目标 macOS 13 仍需实机验证。[Electron 发布日程](https://releases.electronjs.org/schedule)
- 覆盖范围存在明确冲突：Electron 38 起不支持 macOS 11，Electron 44 起不支持 macOS 12；而此前产品目标覆盖所有 Apple Silicon macOS。保留旧系统需评估独立兼容版本及不再获得上游安全更新的影响；使用当前受支持的 Electron 主版本需调整最低系统版本。用户已选择最低 macOS 13，使用受支持的 Electron；macOS 11/12 不在新目标内，当前系统的升级回归已通过，macOS 13 实机验收尚未完成。[Electron 破坏性变更](https://www.electronjs.org/docs/latest/breaking-changes)
- 最新打包应用主可执行文件为 arm64；`@napi-rs/canvas`、`@resvg/resvg-js` 和 Pi TUI 的 darwin-arm64 原生模块在打包 Electron 运行时加载成功。asar.unpacked 仍包含其他平台的部分预构建文件；它们不是 Intel 应用安装包，但应在发布前审查是否可安全排除。
- 尚未验证所有目标 macOS 版本、所有原生路径、实际安装升级和崩溃场景。`better-sqlite3` 13.0.3 已在开发和打包 Electron 45.2.1 中使用临时库验证 SQLite 3.53.4、WAL、完整性检查及 ARM64 原生 ABI；应用数据尚未迁移。

## 3. Electron 窗口和导航

依据 [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)核对并完成本轮收紧：

- `contextIsolation: true`、`nodeIntegration: false`，显式设置 `sandbox: true`；preload 只暴露具名 IPC API，主进程校验来源窗口和主框架。
- 生产构建注入 CSP，限制脚本、资源、worker、frame、连接和对象来源；为当前预览允许必要的 `data:`/`blob:` 图像和内联样式。开发环境不使用此生产 CSP，不能将开发服务器视为可信发布配置。
- 生产导航只允许应用入口文件及其片段；开发模式按 URL 的 origin 判断，拒绝前缀伪造；打包应用忽略开发服务器环境变量。新窗口仍全部拒绝。
- `tests/navigation.test.mjs` 覆盖入口与伪造来源；`tests/desktop-e2e.mjs` 验证主要窗口流程；`tests/office-security-e2e.mjs` 在真实 Electron 窗口和打包应用中验证生产 CSP、沙箱、PDF/DOCX/XLSX/PPTX 基本预览及 Pi 模拟网关。Office fixture 只包含基础内容，**不等于**中文、表格、图片全套验收或安全渗透测试。
- 项目路径检查、文件系统竞态、iframe/文档解析攻击面、IPC 被利用及完整 Electron fuse/权限策略仍需专项测试。Electron 渲染进程沙箱不等于 Pi Agent 或 MCP 服务的操作系统沙箱；Gondolin 按既定决定暂缓。

## 4. 日志和敏感数据

- 源码检查未发现桌面业务主动使用 `console.log` 输出密钥、提示词或附件；这不证明所有依赖和系统日志均已脱敏。
- 发现 Pi MCP 扩展默认可能将服务器 `notifications/message` 原文追加到 Pi agent 目录 `mcp.log`。macOS 当前实现显式将该扩展日志目标设为 `/dev/null`；测试 fixture 发送日志通知后验证不产生测试目录 `mcp.log`。该策略也意味着当前不保留 MCP 服务器日志，连接诊断能力需另行设计。
- 不删除已有 `mcp.log` 或用户文件；MCP 服务自身仍可能在其他位置写日志，本应用无法保证其行为。新旧版本产生的外部文件需要用户自行审查。
- Pi JSONL 是会话历史而非诊断日志，按设计可能包含用户提示、附件文本、模型消息及工具结果；`settings.json` 的定时任务提示词和项目路径也不是加密数据。网关 API Key 使用 `safeStorage` 加密，但密钥链不可用、密钥轮换、敏感数据导出和依赖异常路径仍待完整验收。
- 主进程和 Pi 扩展错误、第三方工具 stderr、诊断导出、日志轮换和权限尚未形成可复用的统一脱敏方案；不能将 E08 的日志审计标为全部通过。

## 5. 本次验证与剩余关闭条件

已执行：`pnpm build`、`pnpm test`（40 项）、Electron 窗口测试、生产 CSP 下的 Office/PDF 基础预览测试、`pnpm dist:mac`、打包应用同样的预览/Pi 工作进程测试、最低版本元数据检查（13.0），三项既有 ARM64 原生模块加载检查、打包 SQLite 临时库 WAL 测试和开发/打包的单实例测试。

关闭 E08 前至少完成：

1. 核对全部生产及分发依赖、缺失许可证文本、MPL/双许可、Electron/Chromium 通知；原 buffers 问题已通过移除依赖解决。
2. 持续复查生产依赖告警，完成新 XLSX 组件的兼容及异常文件验收；当前生产依赖扫描为零告警。
3. 在 macOS 13 等目标 ARM64 设备继续验证 Electron 45、Pi、MCP、原生模块和安装升级。
4. 验证完整日志链、凭据/附件泄露和权限边界；保留既有数据，设计必要的可用诊断而非记录原文。
5. 完成 F08/F13 的 Office 许可、恶意及异常文件处理和中文/表格/图片样例验收，以及 R03 的文件系统/IPC 边界检查。
