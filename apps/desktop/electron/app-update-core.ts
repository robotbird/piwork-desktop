/** 客户端自动更新纯逻辑(无 electron 依赖,可被 node --test 直接运行)。
 版本发现:GitHub Releases latest(api.github.com/repos/<repo>/releases/latest)
 → 与 app.getVersion() semver 比较;安装包为 electron-builder 产物
 `${productName}-${version}-${arch}.dmg`;sha256 取资产 digest 字段(GitHub
 生成,缺失为空,此时仅做 size 校验)。语义对齐 SkillKit check/update 的
 变更检测思路:无新版本、无 DMG 资产 → null。 */
import type { AppUpdateInfo } from '../shared/types';

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** 发布说明展示上限(超出截断),避免异常超长 body 撑爆渲染层 */
export const NOTES_LIMIT = 2000;

type ParsedVersion = { major: number; minor: number; patch: number };

function parseVersion(raw: string): ParsedVersion | null {
 const match = raw.trim().replace(/^v/i, '').match(VERSION_PATTERN);
 if (!match) return null;
 return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** candidate 是否高于 current(容忍 v 前缀;同号预发布不高于正式版;畸形输入返回 false) */
export function isNewerVersion(candidate: string, current: string): boolean {
 const left = parseVersion(candidate);
 const right = parseVersion(current);
 if (!left || !right) return false;
 if (left.major !== right.major) return left.major > right.major;
 if (left.minor !== right.minor) return left.minor > right.minor;
 return left.patch > right.patch;
}

/** 从 release assets 里挑选 DMG:精确 `${productName}-${version}-${arch}.dmg` 优先(artifactName 约定),其余 `-${arch}.dmg` 兜底 */
export function pickDmgAsset(assets: unknown, productName: string, version: string, arch: string): Omit<AppUpdateInfo, 'version' | 'notes'> | null {
 if (!Array.isArray(assets)) return null;
 const candidates: (Omit<AppUpdateInfo, 'version' | 'notes'>)[] = [];
 for (const asset of assets) {
  if (!asset || typeof asset !== 'object') continue;
  const record = asset as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const url = typeof record.browser_download_url === 'string' ? record.browser_download_url : '';
  if (!name || !url || !name.endsWith(`-${arch}.dmg`)) continue;
  const size = typeof record.size === 'number' && Number.isFinite(record.size) && record.size >= 0 ? Math.floor(record.size) : 0;
  const digest = typeof record.digest === 'string' ? record.digest : '';
  const sha256 = digest.startsWith('sha256:') ? digest.slice('sha256:'.length).toLowerCase() : '';
  candidates.push({ assetName: name, downloadUrl: url, size, sha256 });
 }
 return candidates.find(item => item.assetName === `${productName}-${version}-${arch}.dmg`) ?? candidates[0] ?? null;
}

/** GitHub release JSON → 更新信息;无新版本或无 DMG 资产返回 null */
export function parseReleasePayload(payload: unknown, currentVersion: string, productName: string, arch: string): AppUpdateInfo | null {
 if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
 const record = payload as Record<string, unknown>;
 const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : '';
 if (!tag) return null;
 // releases/latest 端点已排除 draft/prerelease;tag 的 v 前缀仅是约定,取余下部分比较
 const version = tag.replace(/^v/i, '');
 if (!isNewerVersion(version, currentVersion)) return null;
 const asset = pickDmgAsset(record.assets, productName, version, arch);
 if (!asset) return null;
 const body = typeof record.body === 'string' ? record.body : '';
 return { version, notes: body.trim().slice(0, NOTES_LIMIT), ...asset };
}

/** 本地更新检查节流记录(<userData>/app-update-state.json);损坏/缺字段回退空对象 */
export type StoredUpdateState = { lastAutoCheckAt?: number };

export function normalizeUpdateState(value: unknown): StoredUpdateState {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
 const raw = (value as Record<string, unknown>).lastAutoCheckAt;
 return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? { lastAutoCheckAt: Math.floor(raw) } : {};
}
