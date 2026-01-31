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
  // private_metadataは3000文字制限があるため、ファイル情報を最小限に絞る
  const files = (payload.message.files ?? []).map((file: any) => ({
    id: file.id,
    name: file.name,
    url_private_download: file.url_private_download,
    mimetype: file.mimetype,
  }));

  const meta = {
    text: payload.message.text ?? "",
    user: payload.user.username ?? payload.user.id,
    channel: payload.channel.name ?? payload.channel.id,
    files,
  };

  const metadataString = JSON.stringify(meta);
  
  // 3000文字制限をチェック（安全マージンとして2900文字に制限）
  if (metadataString.length > 2900) {
    console.warn(
      `[Slack API] private_metadataが大きすぎます: ${metadataString.length}文字。ファイル情報を削減します。`
    );
    // ファイル情報をさらに削減（idとnameのみ）
    const minimalFiles = files.map((file: any) => ({
      id: file.id,
      name: file.name,
    }));
    meta.files = minimalFiles;
    
    // それでも大きい場合は、ファイル情報を空にする（後でfiles.info APIで取得）
    const minimalMetadataString = JSON.stringify(meta);
    if (minimalMetadataString.length > 2900) {
      console.warn(
        `[Slack API] 最小限のファイル情報でも大きすぎます。ファイル情報を空にします。`
      );
      meta.files = [];
    }
  }

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
    // ファイル情報が不完全な場合（IDのみの場合）、files.info APIで情報を取得
    let fileInfo = file;
    if (file.id && (!file.url_private_download || !file.mimetype)) {
      try {
        const fileResponse = await callSlackApi("files.info", { file: file.id });
        fileInfo = {
          id: file.id,
          name: fileResponse.file.name ?? file.name,
          url_private_download: fileResponse.file.url_private_download,
          mimetype: fileResponse.file.mimetype ?? file.mimetype,
        };
      } catch (e) {
        const filename = file.name || file.id || "unknown";
        uploadErrors.push({
          filename,
          reason: e instanceof Error ? e.message : "ファイル情報の取得に失敗しました",
        });
        console.error("files.info failed", filename, e);
        continue;
      }
    }
    try {
      // 1. SlackからダウンロードしてVercel Blobに保存
      const blobFile = await downloadAndStoreSlackFile(fileInfo);
      
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
      const filename = fileInfo.name || file.id || "unknown";
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
