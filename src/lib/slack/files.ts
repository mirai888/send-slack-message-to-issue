import { put } from "@vercel/blob";
import { callSlackApi } from "./slackApi";

interface SlackFile {
  id?: string;
  url_private_download?: string;
  url_private?: string;
  name?: string;
  mimetype?: string;
}

interface UploadedFile {
  filename: string;
  url: string;
  mimetype: string;
  isImage: boolean;
}

export async function downloadAndStoreSlackFile(
  file: SlackFile
): Promise<UploadedFile> {
  const filename = file.name ?? "file";
  const mimetype = file.mimetype;

  if (!file.id) {
    throw new Error(`No file ID for: ${filename}`);
  }

  // files.getURL APIを使って一時的なダウンロードURLを取得
  let downloadUrl: string;
  let finalMimetype = mimetype;

  try {
    console.log(`[Slack File] Getting temporary URL for file ID: ${file.id}`);
    const result = await callSlackApi("files.getURL", {
      file: file.id,
    });

    downloadUrl = result.file?.url_private_download ?? result.url;
    finalMimetype = result.file?.mimetype ?? mimetype;

    if (!downloadUrl) {
      throw new Error(`No download URL from files.getURL`);
    }

    console.log(`[Slack File] Got temporary URL from files.getURL: ${downloadUrl.substring(0, 50)}...`);
  } catch (e) {
    console.error(`[Slack File] files.getURL failed:`, e);
    // フォールバック: payloadから取得したURLを使用
    downloadUrl = file.url_private_download ?? file.url_private ?? "";
    if (!downloadUrl) {
      throw new Error(`No download URL for file: ${filename}`);
    }
    console.log(`[Slack File] Falling back to URL from payload: ${downloadUrl.substring(0, 50)}...`);
  }

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  // SlackのプライベートファイルURLにアクセスするには、Bot Tokenが必要
  // User-Agentヘッダーを追加してブラウザとして認識させる
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
    },
    redirect: 'follow',
  });

  console.log(`[Slack File] Response status: ${res.status}, content-type: ${res.headers.get("content-type")}`);

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[Slack File] Download failed:`, errorText.substring(0, 200));
    throw new Error(`Failed to download Slack file: ${filename} (${res.status})`);
  }

  // レスポンスが HTML（エラーページ）でないか確認
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const html = await res.text();
    console.error(`[Slack File] Received HTML instead of file:`, html.substring(0, 200));
    throw new Error(`Received HTML instead of file: ${filename}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`[Slack File] Downloaded ${buffer.length} bytes`);

  const blob = await put(`slack/${Date.now()}-${filename}`, buffer, {
    access: "public",
    contentType: finalMimetype ?? mimetype,
  });

  const finalMimetypeForReturn = finalMimetype ?? mimetype ?? "application/octet-stream";

  return {
    filename,
    url: blob.url,
    mimetype: finalMimetypeForReturn,
    isImage: finalMimetypeForReturn.startsWith("image/"),
  };
}
