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

  // Bot Tokenのスコープを確認
  try {
    const authTest = await callSlackApi("auth.test", {});
    console.log(`[Slack File] Bot Token info:`, {
      user: authTest.user,
      team: authTest.team,
      url: authTest.url,
    });
  } catch (e) {
    console.error(`[Slack File] auth.test failed:`, e);
  }

  // url_private_download を直接使用（Bearer認証必須）
  const downloadUrl = file.url_private_download ?? file.url_private;
  
  if (!downloadUrl) {
    throw new Error(`No download URL for file: ${filename}`);
  }

  console.log(`[Slack File] Using URL from payload: ${downloadUrl.substring(0, 50)}...`);

  console.log(`[Slack File] Downloading: ${filename} from ${downloadUrl.substring(0, 50)}...`);

  // Bearer認証が必須（これがないとHTMLが返ってくる）
  const authHeader = `Bearer ${botToken}`;
  console.log(`[Slack File] Authorization header: Bearer ${tokenPrefix}...`);

  // リダイレクトを追跡し、User-Agentヘッダーを追加
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: authHeader,
      "User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)",
    },
    redirect: "follow",
  });

  const contentType = res.headers.get("content-type") ?? "";
  console.log(`[Slack File] Response status: ${res.status}, content-type: ${contentType}`);

  // Content-Typeチェック: HTMLが返ってきたらエラー
  if (!res.ok || contentType.includes("text/html")) {
    const text = await res.text();
    console.error(`[Slack File] Slack returned HTML instead of file:`, text.substring(0, 200));
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

  console.log(`[Slack File] Downloaded ${buffer.length} bytes`);

  const finalMimetypeForReturn = mimetype ?? "application/octet-stream";

  const blob = await put(`slack/${Date.now()}-${filename}`, buffer, {
    access: "public",
    contentType: finalMimetypeForReturn,
  });

  return {
    filename,
    url: blob.url,
    mimetype: finalMimetypeForReturn,
    isImage: finalMimetypeForReturn.startsWith("image/"),
  };
}
