# 依赖许可证文本待核实清单

- 更新：2026-11-03；从 `pnpm licenses list --prod --json` 所列已安装生产依赖目录检查常见 LICENSE/LICENCE/COPYING/NOTICE 文件名。
- 缺少文件不代表没有许可；此清单要求核对对应版本的上游许可证和最终分发义务，不自动复制未知版本或推定授权。
- 部分平台原生包的许可文本可能由父包提供，仍需逐一确认。
- 已核对 8 个 `@earendil-works/pi-*` 1.5.0 包：其对应的 [官方仓库 v1.5.0 根 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE) 声明 MIT；尚需将适用文本和版权通知按分发要求纳入产物。已继续根据 npm 包的 `gitHead` 核对 4 个包的上游文件，见下表；其余 10 个包仍需核实。所有条目的分发通知仍未完成。

| 包 | 版本 | package.json 声明 | 来源核查 |
| --- | --- | --- | --- |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 | 待核实具体版本及分发通知 |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 | 待核实具体版本及分发通知 |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 | 待核实具体版本及分发通知 |
| @earendil-works/pi-agent-core | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-ai | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-codemode | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-coding-agent | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-mcp | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-schema | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-telemetry | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @earendil-works/pi-tui | 1.5.0 | MIT | [v1.5.0 上游 LICENSE](https://github.com/earendil-works/pi/blob/v1.5.0/LICENSE)；分发通知待处理 |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT | [npm gitHead 对应上游许可证](https://raw.githubusercontent.com/Brooooooklyn/canvas/db337893b9b53483050ca7b24c6d306e4da06741/LICENSE)；分发通知待处理 |
| @resvg/resvg-js-darwin-arm64 | 2.6.2 | MPL-2.0 | [npm gitHead 对应上游许可证](https://raw.githubusercontent.com/yisibl/resvg-js/9ca058462ac529120c8cc84ddcd6fef644cc5406/LICENSE)；分发通知待处理 |
| brotli | 1.3.3 | MIT | 待核实具体版本及分发通知 |
| data-uri-to-buffer | 4.0.1 | MIT | 待核实具体版本及分发通知 |
| dfa | 1.2.0 | MIT | 待核实具体版本及分发通知 |
| fontkit | 2.0.4 | MIT | 待核实具体版本及分发通知 |
| ignore | 7.0.8 | MIT | [npm gitHead 对应上游许可证](https://raw.githubusercontent.com/kaelzhang/node-ignore/20b802ae9e60c304e7fc71e77ffc246be1a02974/LICENSE-MIT)；分发通知待处理 |
| isarray | 1.0.0 | MIT | 待核实具体版本及分发通知 |
| proxy-agent-negotiate | 1.1.0 | MIT | 待核实具体版本及分发通知 |
| saxes | 6.0.0 | ISC | [npm gitHead 对应上游许可证](https://raw.githubusercontent.com/lddubeau/saxes/211fa0ebec9b628affc09219199639887174bfc3/LICENSE)；分发通知待处理 |
| standardwebhooks | 1.1.1 | MIT | 待核实具体版本及分发通知 |


## 2026-11-05 当前生产依赖重新扫描

本次扫描发现 38 个安装包条目没有独立许可或通知文件；以下是包元数据声明，不能据此推定对应版本的完整分发义务。`apps/desktop/scripts/collect-licenses.mjs` 会生成完整清单，正式发布前须逐项核对实际分发范围、精确版本、版权声明及适用的许可证文件。

| 包 | 版本 | 声明的许可证 | 本地通知文件 |
| --- | --- | --- | --- |
| @ai-sdk/provider-utils | 5.0.5 | Apache-2.0 | NOT FOUND — review required |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 | NOT FOUND — review required |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 | NOT FOUND — review required |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 | NOT FOUND — review required |
| @earendil-works/pi-agent-core | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-ai | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-codemode | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-coding-agent | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-mcp | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-schema | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-telemetry | 1.5.0 | MIT | NOT FOUND — review required |
| @earendil-works/pi-tui | 1.5.0 | MIT | NOT FOUND — review required |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | NOT FOUND — review required |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT | NOT FOUND — review required |
| @next/env | 16.4.4 | MIT | NOT FOUND — review required |
| @next/swc-darwin-arm64 | 16.4.4 | MIT | NOT FOUND — review required |
| @resvg/resvg-js-darwin-arm64 | 2.6.2 | MPL-2.0 | NOT FOUND — review required |
| @schummar/icu-type-parser | 1.21.5 | MIT | NOT FOUND — review required |
| @swc/counter | 0.1.3 | Apache-2.0 | NOT FOUND — review required |
| brotli | 1.3.3 | MIT | NOT FOUND — review required |
| client-only | 0.0.1 | MIT | NOT FOUND — review required |
| cssesc | 3.0.0 | MIT | NOT FOUND — review required |
| data-uri-to-buffer | 4.0.1 | MIT | NOT FOUND — review required |
| dfa | 1.2.0 | MIT | NOT FOUND — review required |
| fastdom | 1.0.12 | MIT | NOT FOUND — review required |
| fontkit | 2.0.4 | MIT | NOT FOUND — review required |
| ignore | 7.0.8 | MIT | NOT FOUND — review required |
| isarray | 1.0.0 | MIT | NOT FOUND — review required |
| jsesc | 3.1.0 | MIT | NOT FOUND — review required |
| next-themes | 0.3.0 | MIT | NOT FOUND — review required |
| postcss-selector-parser | 6.0.10 | MIT | NOT FOUND — review required |
| proxy-agent-negotiate | 1.1.0 | MIT | NOT FOUND — review required |
| react-remove-scroll-bar | 2.3.8 | MIT | NOT FOUND — review required |
| rehype-katex | 7.0.1 | MIT | NOT FOUND — review required |
| remark-math | 6.0.0 | MIT | NOT FOUND — review required |
| saxes | 6.0.0 | ISC | NOT FOUND — review required |
| standardwebhooks | 1.1.1 | MIT | NOT FOUND — review required |
| strictdom | 1.0.1 | MIT | NOT FOUND — review required |
