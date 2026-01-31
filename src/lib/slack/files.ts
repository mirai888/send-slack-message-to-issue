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

  // url_private_download を直接使用（Bearer認証必須）
  const downloadUrl = file.url_private_download ?? file.url_private;
  
  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  // Bot Tokenの確認
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error(`SLACK_BOT_TOKEN is not set`);
  }

  // トークンの形式確認（xoxb-で始まる必要がある）
  const tokenPrefix = botToken.substring(0, 5);
  console.log(`[Slack File] Bot Token prefix: ${tokenPrefix} (should be 'xoxb-')`);

  if (!botToken.startsWith("xoxb-")) {
    throw new Error(`SLACK_BOT_TOKEN must start with 'xoxb-' (Bot Token), got: ${tokenPrefix}...`);
  }

  // Bearer認証が必須（これがないとHTMLが返ってくる）
  const authHeader = `Bearer ${botToken}`;
  console.log(`[Slack File] Authorization header: Bearer ${tokenPrefix}...`);

  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: authHeader,
    },
  });

  const contentType = res.headers.get("content-type") ?? "";
  console.log(`[Slack File] Response status: ${res.status}, content-type: ${contentType}`);

  // Content-Typeチェック: HTMLが返ってきたらエラー
  if (!res.ok || contentType.includes("text/html")) {
    const text = await res.text();
    console.error(`[Slack File] Slack returned HTML instead of file:`, text.substring(0, 200));
    throw new Error(
      `Slack returned HTML instead of file (${filename}): ${text.substring(0, 200)}`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`[Slack File] Downloaded ${buffer.length} bytes`);

  const finalMimetype = mimetype ?? "application/octet-stream";

  const blob = await put(`slack/${Date.now()}-${filename}`, buffer, {
    access: "public",
    contentType: finalMimetype,
  });

  return {
    filename,
    url: blob.url,
    mimetype: finalMimetype,
    isImage: finalMimetype.startsWith("image/"),
  };
}
