import { put, del } from "@vercel/blob";

interface SlackFile {
  url_private_download: string;
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
  const url = file.url_private_download;
  const filename = file.name ?? "file";

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Slack file: ${filename}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const blob = await put(`slack/${Date.now()}-${filename}`, buffer, {
    access: "public",
    contentType: file.mimetype,
  });

  return {
    filename,
    url: blob.url,
    mimetype: file.mimetype ?? "application/octet-stream",
    isImage: file.mimetype?.startsWith("image/") ?? false,
  };
}

/**
 * Vercel Blobのファイルを削除
 * 
 * @param url - Vercel Blob URL
 */
export async function deleteBlobFile(url: string): Promise<void> {
  try {
    await del(url);
    console.log(`[Blob] ファイルを削除しました: ${url}`);
  } catch (error) {
    console.error(`[Blob] ファイルの削除に失敗しました: ${url}`, error);
    // 削除失敗はエラーとして扱わない（ログのみ）
  }
}
