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
  console.log(`[Slack File] Processing file:`, {
    id: file.id,
    name: filename,
    hasUrlPrivateDownload: !!file.url_private_download,
    hasUrlPrivate: !!file.url_private,
    mimetype: file.mimetype,
  });

  let downloadUrl: string;
  let mimetype = file.mimetype;

  // ファイルIDがある場合は files.info API で情報を取得
  if (file.id) {
    console.log(`[Slack File] Fetching file info for ID: ${file.id}`);
    try {
      const fileInfo = await callSlackApi("files.info", {
        file: file.id,
      });

      console.log(`[Slack File] files.info response:`, {
        hasFile: !!fileInfo.file,
        urlPrivateDownload: !!fileInfo.file?.url_private_download,
        urlPrivate: !!fileInfo.file?.url_private,
        mimetype: fileInfo.file?.mimetype,
      });

      downloadUrl = fileInfo.file?.url_private_download ?? fileInfo.file?.url_private;
      mimetype = fileInfo.file?.mimetype ?? mimetype;

      if (!downloadUrl) {
        throw new Error(`No download URL in file info for: ${filename}`);
      }

      console.log(`[Slack File] Got download URL from files.info API`);
    } catch (e) {
      console.error(`[Slack File] files.info failed, falling back to direct URL:`, e);
      // フォールバック: 直接URLを使用
      downloadUrl = file.url_private_download ?? file.url_private ?? "";
      if (!downloadUrl) {
        throw new Error(`No download URL for file: ${filename}`);
      }
    }
  } else {
    // ファイルIDがない場合は直接URLを使用
    downloadUrl = file.url_private_download ?? file.url_private ?? "";
    if (!downloadUrl) {
      throw new Error(`No download URL for file: ${filename}`);
    }
    console.log(`[Slack File] Using direct URL (no file ID)`);
  }

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
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
