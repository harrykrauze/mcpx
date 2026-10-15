import JSZip from 'jszip';
import { GeneratedFile } from '../types/mcp';

export async function downloadFilesAsZip(serverName: string, files: GeneratedFile[]): Promise<void> {
  const zip = new JSZip();
  const folderName = serverName.trim() || 'mcp-server';
  const folder = zip.folder(folderName) || zip;

  for (const file of files) {
    folder.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    // Fallback for non-secure contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    return new Promise((resolve, reject) => {
      if (document.execCommand('copy')) {
        resolve();
      } else {
        reject(new Error('Copy command failed'));
      }
      textArea.remove();
    });
  }
}
