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

  console.info(`[Slack Download] Starting fetch request for ${filename}`);

  // リダイレクトを追跡し、User-Agentヘッダーを追加
  // Serverless環境でのタイムアウト対策として、AbortControllerを使用
  // タイムアウト時間を60秒に延長（PDFなどの大きいファイルに対応）
  let controller = new AbortController();
  let timeoutId = setTimeout(() => {
    controller.abort();
  }, 60000); // 60秒でタイムアウト

  let res: Response | undefined;
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      if (retryCount > 0) {
        console.info(`[Slack Download] Retry attempt ${retryCount} for ${filename}`);
        // リトライ前に少し待機
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
      }

      res = await fetch(downloadUrl, {
        headers: {
          Authorization: authHeader,
          "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      console.info(`[Slack Download] Fetch completed for ${filename}, status: ${res.status}`);
      break; // 成功したらループを抜ける
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === "AbortError") {
        if (retryCount < maxRetries) {
          retryCount++;
          console.warn(`[Slack Download] Timeout for ${filename}, retrying... (${retryCount}/${maxRetries})`);
          // 新しいタイムアウトを設定
          controller = new AbortController();
          timeoutId = setTimeout(() => {
            controller.abort();
          }, 60000);
          continue; // リトライ
        }
        throw new Error(`Slack download timeout after 60 seconds for ${filename} (retried ${retryCount} times)`);
      }
      
      if (retryCount < maxRetries) {
        retryCount++;
        console.warn(`[Slack Download] Fetch failed for ${filename}, retrying... (${retryCount}/${maxRetries}):`, error);
        // 新しいタイムアウトを設定
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          controller.abort();
        }, 60000);
        continue; // リトライ
      }
      
      console.error(`[Slack Download] Fetch failed for ${filename} after ${retryCount} retries:`, error);
      throw error;
    }
  }

  if (!res) {
    throw new Error(`Failed to fetch ${filename} after ${maxRetries} retries`);
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.error(
      `[Slack Download] Slack download failed: ${res.status} ${filename}`,
      text.substring(0, 200)
    );
    throw new Error(
      `Slack download failed: ${res.status} ${filename}. This usually means:\n` +
        `1. The 'files:read' scope is not set in your Slack App\n` +
        `2. The app needs to be reinstalled after adding the scope\n` +
        `3. The Bot Token does not have permission to access this file\n` +
        `Response: ${text.substring(0, 200)}`
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  console.info(
    `[Slack Download] Response OK ${filename}, content-type: ${contentType}`
  );

  // Content-Typeチェック: HTMLが返ってきたらエラー
  if (contentType.includes("text/html")) {
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

  // ストリーム読み込み（arrayBuffer()はPDFなどの大きめバイナリで詰まるため使用しない）
  const chunks: Buffer[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = Readable.fromWeb(res.body as any);

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);

  console.info(
    `[Slack Download] Completed ${filename}, size: ${buffer.length}`
  );

  return {
    filename,
    mimetype: mimetype ?? contentType,
    buffer,
    size: buffer.length,
  };
}
