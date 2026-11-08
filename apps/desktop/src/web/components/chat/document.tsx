// DESKTOP-AUTHORED placeholder at the web document.tsx path. The upstream
// component renders createDocument/updateDocument tool results through the
// artifact store (CodeMirror/ProseMirror editors) — web-only tools that the
// desktop agent never emits. message.tsx imports stay verbatim; if desktop
// ever grows document tools, sync the upstream file and its dependency closure.
export function DocumentToolResult({
  type,
  result,
  isReadonly,
}: {
  type?: string;
  result?: unknown;
  isReadonly?: boolean;
}) {
  return null;
}
