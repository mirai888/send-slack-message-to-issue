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

  console.log(`[Slack File] Getting public URL for file ID: ${file.id}`);

  // files.sharedPublicURL APIを使って公開URLを取得
  let downloadUrl: string;
  try {
    const result = await callSlackApi("files.sharedPublicURL", {
      file: file.id,
    });

    downloadUrl = result.file?.permalink_public ?? result.file?.url_private_download;
    
    if (!downloadUrl) {
      throw new Error(`No public URL returned from files.sharedPublicURL`);
    }

    console.log(`[Slack File] Got public URL: ${downloadUrl.substring(0, 50)}...`);
  } catch (e) {
    console.error(`[Slack File] files.sharedPublicURL failed:`, e);
    // フォールバック: プライベートURLを使用（認証付き）
    downloadUrl = file.url_private_download ?? file.url_private ?? "";
    if (!downloadUrl) {
      throw new Error(`No download URL for file: ${filename}`);
    }
    console.log(`[Slack File] Falling back to private URL: ${downloadUrl.substring(0, 50)}...`);
  }

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  // 公開URLの場合は認証不要、プライベートURLの場合は認証が必要
  const headers: HeadersInit = {};
  if (downloadUrl.includes("files-pri")) {
    headers.Authorization = `Bearer ${process.env.SLACK_BOT_TOKEN}`;
  }

  const res = await fetch(downloadUrl, { headers });

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
    contentType: mimetype,
  });

  const finalMimetype = mimetype ?? "application/octet-stream";

  return {
    filename,
    url: blob.url,
    mimetype: finalMimetype,
    isImage: finalMimetype.startsWith("image/"),
  };
}
