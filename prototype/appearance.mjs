export const APPEARANCE_KEY = 'piwork-prototype-appearance';
export const LEGACY_KEY = 'piwork-prototype-theme';
const valid = new Set(['system', 'light', 'dark']);

export function readAppearance(storage) {
  try {
    const current = storage.getItem(APPEARANCE_KEY);
    if (valid.has(current)) return current;
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch { /* Storage can be unavailable in private or restricted contexts. */ }
  return 'system';
}

export function resolveAppearance(preference, systemDark) {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function saveAppearance(storage, preference) {
  if (!valid.has(preference)) throw new TypeError('Invalid appearance preference');
  try { storage.setItem(APPEARANCE_KEY, preference); return true; }
  catch { return false; }
}
