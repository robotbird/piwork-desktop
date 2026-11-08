import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// "@/*" mirrors the piwork web repo's alias so copied files keep their imports
// unchanged; "@desktop/*" is desktop-authored code (compat shims, adapters).
const web = fileURLToPath(new URL('./src/web', import.meta.url));
const desktop = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig(({command})=>({base:'./',resolve:{alias:{'@':web,'@desktop':desktop}},plugins:[{name:'production-csp',transformIndexHtml(html){return command==='build'?html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;; script-src &apos;self&apos;; style-src &apos;self&apos; &apos;unsafe-inline&apos;; img-src &apos;self&apos; data: blob:; font-src &apos;self&apos; data: blob:; worker-src &apos;self&apos; blob:; frame-src &apos;self&apos; preview:; connect-src &apos;self&apos;; object-src &apos;none&apos;; base-uri &apos;none&apos;">'):html}},react(),tailwindcss(),electron({main:{entry:'electron/main.ts',vite:{resolve:{alias:[{find:/^@\//,replacement:`${web}/`}]},build:{rollupOptions:{input:{main:'electron/main.ts','chat-worker':'electron/chat-worker.ts','mcp-test-worker':'electron/mcp-test-worker.ts','metadata-store':'electron/metadata-store.ts','legacy-migration':'electron/legacy-migration.ts','metadata-backup':'electron/metadata-backup.ts'},external:(id:string)=>id.startsWith('@earendil-works/')||id==='better-sqlite3'||id==='pdfjs-dist/legacy/build/pdf.mjs'}}}},preload:{input:'electron/preload.ts'}})]}));
