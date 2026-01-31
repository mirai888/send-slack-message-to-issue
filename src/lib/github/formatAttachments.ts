/**
 * GitHub Issueコメント用の添付ファイルフォーマット
 * 
 * アセットリポジトリのraw URLを使ってMarkdown形式でフォーマットする
 * 
 * - 画像: インライン表示（![filename](rawUrl)）
 * - PDF/Excel: リンク形式（📄 [filename](rawUrl)）
 * - その他: リンク形式（📎 [filename](rawUrl)）
 * 
 * 参考: https://zenn.dev/optimind/articles/slack-images-and-files-to-github-sync
 */

interface AttachmentFile {
  filename: string;
  url: string; // raw URL（画像プレビュー用）
  repoUrl?: string; // リポジトリ内のファイルURL（オプション）
  mimetype: string;
}

export function formatAttachments(files: AttachmentFile[]): string {
  if (files.length === 0) return "";

  const lines = files.map((f) => {
    // 画像: GitHub上でインライン表示
    if (f.mimetype.startsWith("image/")) {
      return `![${f.filename}](${f.url})`;
    }
    // PDF: GitHub管理下URLへのリンク
    if (f.mimetype === "application/pdf") {
      return `📄 [${f.filename}](${f.url})`;
    }
    // Excelファイル: GitHub管理下URLへのリンク
    if (
      f.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      f.mimetype === "application/vnd.ms-excel" ||
      f.mimetype === "text/csv" ||
      f.filename.match(/\.(xlsx|xls|csv)$/i)
    ) {
      return `📊 [${f.filename}](${f.url})`;
    }
    // その他: リンク形式
    return `📎 [${f.filename}](${f.url})`;
  });

  return `
### 添付ファイル
${lines.join("\n")}
`;
}
