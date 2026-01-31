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
  
  // タイムアウト設定（30秒）- Promise.raceを使用してより確実にタイムアウトを実装
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.log("[A7-TIMEOUT] downloadSlackFile: タイムアウト発生（30秒経過）");
      reject(new Error("Slack download timeout: Request took longer than 30 seconds"));
    }, 30000);
  });
  
  const controller = new AbortController();
  const fetchPromise = fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
    },
    redirect: "follow",
    signal: controller.signal,
  });
  
  let res: Response;
  try {
    console.log("[A7-2] downloadSlackFile: fetch実行中...");
    res = await Promise.race([fetchPromise, timeoutPromise]);
    // fetchが完了したらタイムアウトをクリア
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    console.log(`[A8] downloadSlackFile: fetchリクエスト完了 - status: ${res.status}`);
    console.log(`[A8-1] downloadSlackFile: Response headers - ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`);
  } catch (error) {
    // タイムアウトの場合はAbortControllerも中止
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    controller.abort();
    console.log(`[A7-ERROR] downloadSlackFile: エラー発生 - ${error instanceof Error ? error.message : "Unknown error"}`);
    console.log(`[A7-ERROR-2] downloadSlackFile: エラー詳細 - ${error instanceof Error ? error.stack : "No stack trace"}`);
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timeout"))) {
      throw new Error("Slack download timeout: Request took longer than 30 seconds");
    }
    throw new Error(`Slack download failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = Readable.fromWeb(res.body as any);
    
    // ストリーム読み込みタイムアウト（60秒）
    let streamTimeoutId: NodeJS.Timeout | null = null;
    const resetTimeout = () => {
      if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
      }
      streamTimeoutId = setTimeout(() => {
        stream.destroy(new Error("Stream read timeout: No data received for 60 seconds"));
      }, 60000);
    };
    
    resetTimeout();

    for await (const chunk of stream) {
      resetTimeout();
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    
    if (streamTimeoutId) {
      clearTimeout(streamTimeoutId);
    }
  } catch (error) {
    throw new Error(`Stream read failed: ${error instanceof Error ? error.message : "Unknown error"}`);
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
