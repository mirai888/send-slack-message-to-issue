/**
 * Slackファイルのダウンロード処理
 * 
 * Bot Tokenを使用して url_private_download からファイルを取得
 * Vercel Blob や S3 は一切使わず、メモリ上で処理する
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

  // url_private_download がない場合は、Slack APIからファイル情報を再取得
  let fileInfo = file;
  if (!file.url_private_download && !file.url_private && file.id) {
    console.log(`[Slack Download] Fetching file info for ${file.id}`);
    const fileResponse = await callSlackApi("files.info", { file: file.id });
    fileInfo = fileResponse.file;
  }

  const downloadUrl = fileInfo.url_private_download ?? fileInfo.url_private;

  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }

  console.log(
    `[Slack Download] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`
  );

  // Bearer認証が必須（これがないとHTMLが返ってくる）
  const authHeader = `Bearer ${botToken}`;

  // リダイレクトを追跡し、User-Agentヘッダーを追加
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: authHeader,
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
    },
    redirect: "follow",
  });

  const contentType = res.headers.get("content-type") ?? "";
  console.log(
    `[Slack Download] Response status: ${res.status}, content-type: ${contentType}`
  );

  // Content-Typeチェック: HTMLが返ってきたらエラー
  if (!res.ok || contentType.includes("text/html")) {
    const text = await res.text();
    console.error(
      `[Slack Download] Slack returned HTML instead of file:`,
      text.substring(0, 200)
    );
    throw new Error(
      `Slack returned HTML instead of file (${filename}). This usually means:\n` +
        `1. The 'files:read' scope is not set in your Slack App\n` +
        `2. The app needs to be reinstalled after adding the scope\n` +
        `3. The Bot Token does not have permission to access this file\n` +
        `Response: ${text.substring(0, 200)}`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`[Slack Download] Downloaded ${buffer.length} bytes`);

  return {
    filename,
    mimetype: mimetype ?? contentType,
    buffer,
    size: buffer.length,
  };
}
