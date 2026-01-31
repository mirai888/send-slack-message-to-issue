interface AttachmentFile {
  filename: string;
  url: string;
  mimetype: string;
}

export function formatAttachments(files: AttachmentFile[]): string {
  if (files.length === 0) return "";

  const lines = files.map((f) => {
    if (f.mimetype.startsWith("image/")) {
      return `![${f.filename}](${f.url})`;
    }
    if (f.mimetype === "application/pdf") {
      return `📄 [${f.filename}](${f.url})`;
    }
    // Excelファイル（.xlsx, .xls, .csv）
    if (
      f.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      f.mimetype === "application/vnd.ms-excel" ||
      f.mimetype === "text/csv" ||
      f.filename.match(/\.(xlsx|xls|csv)$/i)
    ) {
      return `📊 [${f.filename}](${f.url})`;
    }
    return `📎 [${f.filename}](${f.url})`;
  });

  return `
### 添付ファイル
${lines.join("\n")}
`;
}
