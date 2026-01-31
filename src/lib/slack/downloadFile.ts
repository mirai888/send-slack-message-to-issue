/**
 * Slackファイルのダウンロード処理
 * 
 * Bot Tokenを使用して url_private_download からファイルを取得
 * Vercel Blob や S3 は一切使わず、メモリ上で処理する
 * 
 * 過去のVercel Blob実装では arrayBuffer() を使用していたため、
 * 同じアプローチを採用（Vercel環境での互換性のため）
 */

import { callSlackApi } from "./slackApi";

interface SlackFile {
  id?: string;
  url_private_download?: string;
  url_private?: string;
  name?: string;
  mimetype?: string;
  size?: number;
}

export interface DownloadedFile {
  filename: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * SlackファイルをダウンロードしてBufferとして返す
 * 
 * @param file - Slackファイル情報（payload.message.files[] の要素）
 * @returns ダウンロードされたファイルのBufferとメタデータ
 */
export async function downloadSlackFile(
  file: SlackFile
): Promise<DownloadedFile> {
  console.log("[A1] downloadSlackFile: 開始");
  
  const filename = file.name ?? "file";
  const mimetype = file.mimetype ?? "application/octet-stream";
  console.log(`[A2] downloadSlackFile: ファイル情報を取得 - ${filename} (${mimetype})`);

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN is not set");
  }

  if (!botToken.startsWith("xoxb-")) {
    throw new Error(
      `SLACK_BOT_TOKEN must start with 'xoxb-' (Bot Token), got: ${botToken.substring(0, 5)}...`
    );
  }
  console.log("[A3] downloadSlackFile: Bot Tokenの確認完了");

  let fileInfo = file;
  if (!file.url_private_download && !file.url_private && file.id) {
    console.log(`[A4] downloadSlackFile: Slack APIからファイル情報を再取得 - ${file.id}`);
    const fileResponse = await callSlackApi("files.info", { file: file.id });
    fileInfo = fileResponse.file;
    console.log("[A5] downloadSlackFile: ファイル情報の取得完了");
  }

  const downloadUrl = fileInfo.url_private_download ?? fileInfo.url_private;
  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }
  console.log(`[A6] downloadSlackFile: ダウンロードURLを取得 - ${downloadUrl.substring(0, 50)}...`);

  console.log("[A7] downloadSlackFile: fetchリクエストを開始");
  
  // 過去のVercel Blob実装と同じシンプルなfetchオプションを使用
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });
  console.log(`[A8] downloadSlackFile: fetchリクエスト完了 - status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack download failed: ${res.status} ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  console.log(`[A9] downloadSlackFile: Content-Typeを確認 - ${contentType}`);
  
  if (contentType.includes("text/html")) {
    const text = await res.text();
    throw new Error(`Slack returned HTML instead of file: ${text.substring(0, 200)}`);
  }

  console.log("[A10] downloadSlackFile: arrayBuffer()で読み込みを開始");
  // 過去のVercel Blob実装と同じく arrayBuffer() を使用
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log(`[A11] downloadSlackFile: 読み込み完了 - ${buffer.length} bytes`);

  console.log("[A12] downloadSlackFile: 完了");
  return {
    filename,
    mimetype: mimetype ?? contentType,
    buffer,
    size: buffer.length,
  };
}
