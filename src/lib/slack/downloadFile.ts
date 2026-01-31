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
  console.log(`[A7-1] downloadSlackFile: ダウンロードURL - ${downloadUrl}`);
  
  // AbortControllerでタイムアウト管理（Promise.raceは使わない）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log("[A7-TIMEOUT] downloadSlackFile: AbortController発火");
    controller.abort();
  }, 30000);

  let res: Response;
  try {
    console.log("[A7-2] downloadSlackFile: fetch実行中...");
    res = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${botToken}`,
        "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
      },
      redirect: "manual", // 超重要：redirect followは無限ループの原因
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.log(`[A7-ERROR] downloadSlackFile: エラー発生 - ${err instanceof Error ? err.message : "Unknown error"}`);
    throw new Error(
      `Slack fetch failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  clearTimeout(timeoutId);
  console.log(`[A8] downloadSlackFile: fetch完了 status=${res.status}`);

  // Slackのurl_private_downloadはほぼ必ず302を返すので、1回だけ手動で追跡
  if (res.status === 302) {
    const location = res.headers.get("location");
    if (!location) {
      throw new Error("Slack redirect without location header");
    }

    console.log(`[A8-REDIRECT] downloadSlackFile: redirect to ${location.substring(0, 50)}...`);

    // リダイレクト先へのリクエスト（タイムアウトは引き続き有効）
    const redirectTimeoutId = setTimeout(() => {
      console.log("[A8-REDIRECT-TIMEOUT] downloadSlackFile: リダイレクト先のタイムアウト");
      controller.abort();
    }, 30000);

    try {
      res = await fetch(location, {
        headers: {
          Authorization: `Bearer ${botToken}`,
          "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
        },
        signal: controller.signal,
      });
      clearTimeout(redirectTimeoutId);
      console.log(`[A8-REDIRECT-OK] downloadSlackFile: リダイレクト先のfetch完了 status=${res.status}`);
    } catch (err) {
      clearTimeout(redirectTimeoutId);
      throw new Error(
        `Slack redirect fetch failed: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack download failed: ${res.status} ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  console.log(`[A9] downloadSlackFile: Content-Typeを確認 - ${contentType}`);
  
  if (contentType.includes("text/html")) {
    const text = await res.text();
    throw new Error(`Slack returned HTML instead of file: ${text.substring(0, 200)}`);
  }

  console.log("[A10] downloadSlackFile: ストリーム読み込みを開始");
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = Readable.fromWeb(res.body as any);

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  console.log(`[A11] downloadSlackFile: ストリーム読み込み完了 - ${buffer.length} bytes`);

  console.log("[A12] downloadSlackFile: 完了");
  return {
    filename,
    mimetype: mimetype ?? contentType,
    buffer,
    size: buffer.length,
  };
}
