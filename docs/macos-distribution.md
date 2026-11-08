# macOS 测试包与验收

PiWork Desktop 使用 electron-builder 生成 Apple Silicon 的 DMG 和 ZIP，最低目标为 macOS 13。执行 `pnpm dist:mac` 会先收集当前生产依赖中可找到的许可文件，再构建安装包；默认产物位于 `apps/desktop/release/`。`pnpm pack:mac` 生成应用目录用于调试。

本轮隔离构建位于 `apps/desktop/release/mvp17-current/`。DMG 可挂载后将 `PiWork.app` 拖到 Applications；ZIP 解压后也可安装。应用未使用 Apple 开发者证书签名或公证，首次打开可能需要在 macOS 安全设置中明确允许。不要覆盖正在使用的应用；安装或替换前先退出 PiWork。

应用配置和会话保存在用户数据目录，正常替换应用包不应修改项目源文件。本轮在 macOS 26 ARM64 使用独立用户数据及应用目录，验证了从已有 0.1.0 构建替换为新 0.1.0 构建后，配置、项目和对话保留；这并不等于跨版本迁移或 macOS 13 实机验收。

包内 `Contents/Resources/licenses/README.md` 列出扫描范围、已有许可证文件和待核查项，Electron 和 Chromium 通知同目录提供。当前有未核实项，具体见 [待核实清单](third-party-license-missing.md)；在核验完成前，本轮包仅供本地测试。

## 发版流水线与客户端自动更新

发版走 GitHub Actions（`.github/workflows/release.yml`）：修改 `apps/desktop/package.json` 的 `version` → 提交 → 打同名 `vX.Y.Z` tag → push。CI 在 macos-14（arm64）上校验 tag 与版本一致、重建原生模块后执行 `pnpm release:mac`（electron-builder `--publish always`），自动创建 GitHub Release 并上传 `PiWork-<version>-arm64.dmg/.zip` 与 `latest-mac.yml`。

客户端内置自动更新（`apps/desktop/electron/app-update.ts` 与 `app-update-core.ts`）：启动约 3 秒后静默检查 GitHub Releases latest（本地节流 24 小时，记录于 `<userData>/app-update-state.json`），设置 → 关于 → 软件更新卡片可手动「检查更新」。发现新版本后主界面侧栏底部出现「新版本 vX.Y.Z」入口；「下载更新」将 DMG 流式下载到 `<userData>/updates/`，按 GitHub 资产 digest 做 sha256 校验（无 digest 时仅校验 size），支持取消与同版本免重复下载。因应用未签名，安装方式为「打开安装包」挂载 DMG，由用户拖入 Applications；不做自动替换。更新源可用 `PIWORK_UPDATE_API` 环境变量覆盖（测试注入 mock 用）；未打包的 dev 运行不启用检查（设该变量时除外）。
