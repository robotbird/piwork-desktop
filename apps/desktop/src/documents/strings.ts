// Desktop-only strings for the 我的文档 library. Kept out of the synced web
// i18n catalogs (src/web/i18n/messages) so `sync-from-web` stays clean.
export type LibraryLanguage = 'zh-CN' | 'en';
export const libraryStrings: Record<LibraryLanguage, {
  exportCopy: string;
  openExternally: string;
  revealInFinder: string;
  delete: string;
  deleteFileConfirm: string;
  deleteFolderConfirm: string;
  deleted: string;
  previewLoading: string;
  previewFailed: string;
  previewUnsupported: string;
  close: string;
  savedToLibrary: string;
  nameInUse: string;
  invalidInput: string;
}> = {
  'zh-CN': {
    exportCopy: '导出副本',
    openExternally: '用默认应用打开',
    revealInFinder: '在访达中显示',
    delete: '删除',
    deleteFileConfirm: '删除「{name}」？文件将移到系统废纸篓。',
    deleteFolderConfirm: '删除文件夹「{name}」？其中所有内容将移到系统废纸篓。',
    deleted: '已删除',
    previewLoading: '正在加载…',
    previewFailed: '无法预览此文件。支持 1 MB 以内的文本、10 MB 以内的图片和 20 MB 以内的 PDF、DOCX、XLSX、PPTX。',
    previewUnsupported: '此文件暂不支持预览，可尝试用系统应用打开。',
    close: '关闭',
    savedToLibrary: '已保存到我的文档',
    nameInUse: '该名称已被使用，请换一个名称。',
    invalidInput: '名称或内容无效，请检查后重试。',
  },
  en: {
    exportCopy: 'Export a copy',
    openExternally: 'Open with default app',
    revealInFinder: 'Show in Finder',
    delete: 'Delete',
    deleteFileConfirm: 'Delete "{name}"? The file will be moved to the Trash.',
    deleteFolderConfirm: 'Delete folder "{name}"? Everything inside will be moved to the Trash.',
    deleted: 'Deleted',
    previewLoading: 'Loading…',
    previewFailed: 'Cannot preview this file. Text up to 1 MB, images up to 10 MB and PDF, DOCX, XLSX, PPTX files up to 20 MB are supported.',
    previewUnsupported: 'Preview is unavailable. Try opening it with a system app.',
    close: 'Close',
    savedToLibrary: 'Saved to my documents',
    nameInUse: 'That name is already in use. Try another one.',
    invalidInput: 'Invalid name or content. Check it and try again.',
  },
};
