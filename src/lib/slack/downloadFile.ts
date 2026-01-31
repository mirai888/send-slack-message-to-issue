/**
 * Slackファイルのダウンロード処理
 * 
 * Bot Tokenを使用して url_private_download からファイルを取得
 * Vercel Blob や S3 は一切使わず、メモリ上で処理する
 * 
 * 注意: PDFなどの大きめバイナリファイルでは arrayBuffer() ではなく
 * ストリーム読み込みを使用（Serverless環境での詰まりを回避）
 */

import { Readable } from "stream";
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
  const filename = file.name ?? "file";
  const mimetype = file.mimetype ?? "application/octet-stream";

  // Bot Tokenの確認
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN is not set");
  }

  if (!botToken.startsWith("xoxb-")) {
    throw new Error(
      `SLACK_BOT_TOKEN must start with 'xoxb-' (Bot Token), got: ${botToken.substring(0, 5)}...`
    );
  }

  let fileInfo = file;
  if (!file.url_private_download && !file.url_private && file.id) {
    const fileResponse = await callSlackApi("files.info", { file: file.id });
    fileInfo = fileResponse.file;
  }

  const downloadUrl = fileInfo.url_private_download ?? fileInfo.url_private;
  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }

  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
    },
    redirect: "follow",
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack download failed: ${res.status} ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const text = await res.text();
    throw new Error(`Slack returned HTML instead of file: ${text.substring(0, 200)}`);
  }

  // ストリーム読み込み（arrayBuffer()はPDFなどの大きめバイナリで詰まるため使用しない）
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = Readable.fromWeb(res.body as any);

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);

  return {
    filename,
    mimetype: mimetype ?? contentType,
    buffer,
    size: buffer.length,
  };
}
