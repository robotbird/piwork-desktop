// DESKTOP-AUTHORED placeholder at the web document-preview.tsx path (see
// document.tsx note): the upstream preview loads artifact documents through
// SWR + CodeMirror editors, none of which exist on desktop.
export function DocumentPreview({
  isReadonly,
  result,
  args,
}: {
  isReadonly?: boolean;
  result?: unknown;
  args?: unknown;
}) {
  return null;
}
