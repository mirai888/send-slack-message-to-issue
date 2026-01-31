import { verifySlackRequest } from "@/lib/slack/verify";
import { callSlackApi } from "@/lib/slack/slackApi";
import { downloadAndStoreSlackFile, deleteBlobFile } from "@/lib/slack/files";
import { uploadBlobFileToGitHub } from "@/lib/github/uploadAsset";
import { postIssueComment } from "@/lib/github/issue";
import { formatAttachments } from "@/lib/github/formatAttachments";

export const runtime = "nodejs";


export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifySlackRequest(req, rawBody)) {
    return new Response("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") || "{}");

  // ① Message Action → モーダル
  if (payload.type === "message_action") {
    await openIssueSelectModal(payload);
    return new Response("", { status: 200 });
  }

  // ② モーダル送信 → Issue投稿
  if (payload.type === "view_submission") {
    await handleSubmit(payload);
    return new Response(
      JSON.stringify({ response_action: "clear" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return new Response("", { status: 200 });
}

/* ---------- handlers ---------- */

async function openIssueSelectModal(payload: any) {
  const meta = {
    text: payload.message.text ?? "",
    user: payload.user.username ?? payload.user.id,
    channel: payload.channel.name ?? payload.channel.id,
    files: payload.message.files ?? [],
  };

  await callSlackApi("views.open", {
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: "select_issue_modal",
      private_metadata: JSON.stringify(meta),
      title: { type: "plain_text", text: "Send to Issue" },
      submit: { type: "plain_text", text: "Send" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "issue",
          label: { type: "plain_text", text: "GitHub Issue" },
          element: {
            type: "external_select",
            action_id: "issue_select",
            placeholder: {
              type: "plain_text",
              text: "番号 or タイトルで検索",
            },
            min_query_length: 1,
          },
        },
      ],
    },
  });
}

async function handleSubmit(payload: any) {
  const state = payload.view.state.values;
  const issueNumber =
    state.issue.issue_select.selected_option.value;

  const meta = JSON.parse(payload.view.private_metadata);

  // 添付ファイル処理
  const slackFiles = meta.files ?? [];
  const uploadedFiles: Array<{
    filename: string;
    url: string;
    isImage: boolean;
  }> = [];
  const uploadErrors: Array<{
    filename: string;
    reason: string;
  }> = [];

  for (const file of slackFiles) {
    try {
      // 1. SlackからダウンロードしてVercel Blobに保存
      const blobFile = await downloadAndStoreSlackFile(file);
      
      // 2. Vercel BlobからダウンロードしてGitHubにアップロード
      const result = await uploadBlobFileToGitHub(
        {
          url: blobFile.url,
          filename: blobFile.filename,
          mimetype: blobFile.mimetype,
        },
        issueNumber
      );

      if ("url" in result) {
        uploadedFiles.push({
          filename: result.filename,
          url: result.url,
          isImage: result.isImage,
        });
        
        // 3. GitHubへのアップロード成功後、Vercel Blobのファイルを削除
        await deleteBlobFile(blobFile.url);
      } else {
        uploadErrors.push({
          filename: result.filename,
          reason: result.reason,
        });
        
        // GitHubへのアップロード失敗時もVercel Blobのファイルを削除（不要なファイルを残さない）
        await deleteBlobFile(blobFile.url);
      }
    } catch (e) {
      const filename = file.name || "unknown";
      uploadErrors.push({
        filename,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
      console.error("file upload failed", filename, e);
    }
  }

  const body = formatIssueComment({
    text: meta.text,
    user: meta.user,
    channel: meta.channel,
    attachments: formatAttachments(uploadedFiles),
    errors: uploadErrors,
  });

  await postIssueComment(issueNumber, body);
}

function formatIssueComment({
  text,
  user,
  channel,
  attachments,
  errors,
}: {
  text: string;
  user: string;
  channel: string;
  attachments: string;
  errors?: Array<{ filename: string; reason: string }>;
}) {
  const quoted = text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

  let errorSection = "";
  if (errors && errors.length > 0) {
    const errorLines = errors.map(
      (e) => `- \`${e.filename}\`: ${e.reason}`
    );
    errorSection = `
### ⚠️ アップロードできなかったファイル
${errorLines.join("\n")}
`;
  }

  return `
## Slackから共有 🧵

**投稿者**: @${user}  
**チャンネル**: #${channel}

${quoted || "> （本文なし）"}
${attachments}
${errorSection}
`.trim();
}
