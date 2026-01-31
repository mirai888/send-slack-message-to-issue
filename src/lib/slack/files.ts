import { put } from "@vercel/blob";

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

  // payloadから取得したURLを直接使用
  // files.info APIは呼び出し方法が複雑なため、payloadに含まれる情報を使用
  const downloadUrl = file.url_private_download ?? file.url_private;
  const finalMimetype = mimetype;

  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }

  console.log(`[Slack File] Using URL from payload: ${downloadUrl.substring(0, 50)}...`);

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  // SlackのプライベートファイルURLにアクセスするには、Bot Tokenが必要
  // redirect: 'follow' を指定してリダイレクトを追跡
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
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
