// DESKTOP-ADAPTED copy of piwork lib/utils.ts — trimmed to the framework-free
// helpers (cn, copyTextToClipboard, generateUUID, sanitizeText). Upstream
// helpers that depend on @/lib/db/schema, @/lib/types, ./errors or date-fns
// (fetcher, fetchWithErrorHandlers, convertToUIMessages, getTextFromMessage,
// getDocumentTimestampByIndex) are excluded until those modules are synced.
// When re-syncing from upstream, re-trim to this helper set.
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 异步 Clipboard API 只在 secure context（HTTPS 或 localhost）下可用；
// 生产环境可能通过 http://IP:端口 访问，此时 navigator.clipboard 为 undefined，
// 需要退回隐藏 textarea + document.execCommand('copy') 的经典兜底。
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒或文档失焦等情况，继续尝试 execCommand 兜底。
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);
  return succeeded;
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}
