interface AttachmentFile {
  filename: string;
  url: string;
  isImage: boolean;
}

export function formatAttachments(files: AttachmentFile[]): string {
  if (files.length === 0) return "";

  const lines = files.map((f) =>
    f.isImage
      ? `![${f.filename}](${f.url})`
      : `📎 [${f.filename}](${f.url})`
  );

  return `
### 添付ファイル
${lines.join("\n")}
`;
}
