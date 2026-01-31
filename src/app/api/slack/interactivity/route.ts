import { verifySlackRequest } from "@/lib/slack/verify";
import { callSlackApi } from "@/lib/slack/slackApi";
import { postIssueComment } from "@/lib/github/issue";
import { formatAttachments } from "@/lib/github/formatAttachments";
import { uploadSlackFileToGitHub } from "@/lib/github/uploadAsset";

export const runtime = "nodejs";
export const maxDuration = 60; // 秒（PDF/Excelなどの重いファイル処理に対応）

// Slack Interactivity payload の型定義
interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
}

interface SlackMessageActionPayload {
  type: "message_action";
  trigger_id: string;
  message: {
    text?: string;
    files?: SlackFile[];
  };
  user: {
    id: string;
    username?: string;
  };
  channel: {
    id: string;
    name?: string;
  };
}

interface SlackViewSubmissionPayload {
  type: "view_submission";
  view: {
    state: {
      values: {
        issue: {
          issue_select: {
            selected_option: {
              value: string;
            };
          };
        };
      };
    };
    private_metadata: string;
  };
}


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
    // Slackには即レスポンス（3秒制限対応）
    // Promiseを作成して即ACK（queueMicrotaskは使わない - Serverless環境でプロセスが途中で終了するため）
    handleSubmit(payload)
      .then(() => console.info("[Submit] Successfully completed"))
      .catch((e) => {
        console.error("[Submit] Failed with error:", e);
        if (e instanceof Error) {
          console.error("[Submit] Error message:", e.message);
          console.error("[Submit] Error stack:", e.stack);
        }
      });

    return new Response(
      JSON.stringify({ response_action: "clear" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return new Response("", { status: 200 });
}

/* ---------- handlers ---------- */

async function openIssueSelectModal(payload: SlackMessageActionPayload) {
  // private_metadataは3000文字制限があるため、最小限の情報のみ保存
  const files = (payload.message.files ?? []).map((file: SlackFile) => ({
    id: file.id,
    name: file.name,
    mimetype: file.mimetype,
    url_private_download: file.url_private_download,
    url_private: file.url_private,
  }));

  const meta = {
    text: payload.message.text ?? "",
    user: payload.user.username ?? payload.user.id,
    channel: payload.channel.name ?? payload.channel.id,
    files,
  };

  const metadataJson = JSON.stringify(meta);
  
  // 3000文字制限チェック（念のため）
  if (metadataJson.length > 3000) {
    console.warn(`[Interactivity] private_metadata is too long: ${metadataJson.length} chars. Truncating files.`);
    // ファイル情報をさらに最小限に（idとnameだけ）
    const minimalFiles = (payload.message.files ?? []).map((file: SlackFile) => ({
      id: file.id,
      name: file.name,
      mimetype: file.mimetype,
      url_private_download: undefined,
      url_private: undefined,
    }));
    meta.files = minimalFiles;
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

async function handleSubmit(payload: SlackViewSubmissionPayload) {
  console.log("[1] handleSubmit: 開始");
  
  const state = payload.view.state.values;
  const issueNumber =
    state.issue.issue_select.selected_option.value;
  console.log(`[2] handleSubmit: Issue番号を取得 - #${issueNumber}`);

  const meta = JSON.parse(payload.view.private_metadata);
  const slackFiles = meta.files ?? [];
  console.log(`[3] handleSubmit: ファイル数を取得 - ${slackFiles.length}件`);

  const uploadedFiles: Array<{
    filename: string;
    url: string;
    mimetype: string;
  }> = [];
  const uploadErrors: Array<{
    filename: string;
    reason: string;
  }> = [];

  // ファイルごとに try/catch し、1つ失敗しても他は続行する
  for (let i = 0; i < slackFiles.length; i++) {
    const file = slackFiles[i];
    console.log(`[4-${i + 1}] handleSubmit: ファイル ${i + 1}/${slackFiles.length} の処理を開始 - ${file.name || file.id}`);
    
    try {
      let fileInfo = file;
      if (!file.url_private_download && !file.url_private && file.id) {
        console.log(`[4-${i + 1}-1] handleSubmit: Slack APIからファイル情報を再取得 - ${file.id}`);
        const fileResponse = await callSlackApi("files.info", { file: file.id });
        fileInfo = fileResponse.file;
        console.log(`[4-${i + 1}-2] handleSubmit: ファイル情報の取得完了`);
      }

      console.log(`[4-${i + 1}-3] handleSubmit: GitHubへのアップロードを開始`);
      const result = await uploadSlackFileToGitHub(fileInfo, issueNumber);
      console.log(`[4-${i + 1}-4] handleSubmit: GitHubへのアップロード完了`);

      if ("url" in result) {
        uploadedFiles.push({
          filename: result.filename,
          url: result.url,
          mimetype: result.mimetype,
        });
        console.log(`[4-${i + 1}-5] handleSubmit: アップロード成功 - ${result.filename}`);
      } else {
        uploadErrors.push({
          filename: result.filename,
          reason: result.reason,
        });
        console.log(`[4-${i + 1}-5] handleSubmit: アップロードスキップ - ${result.filename}: ${result.reason}`);
      }
    } catch (e) {
      const filename = file.name || file.id || "unknown";
      uploadErrors.push({
        filename,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
      console.log(`[4-${i + 1}-ERROR] handleSubmit: エラー発生 - ${filename}: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }

  console.log(`[5] handleSubmit: コメント本文を生成開始`);
  const body = formatIssueComment({
    text: meta.text,
    user: meta.user,
    channel: meta.channel,
    attachments: formatAttachments(uploadedFiles),
    errors: uploadErrors,
  });
  console.log(`[6] handleSubmit: コメント本文の生成完了 - ${body.length}文字`);

  console.log(`[7] handleSubmit: Issueコメントの投稿を開始`);
  await postIssueComment(issueNumber, body);
  console.log(`[8] handleSubmit: Issueコメントの投稿完了`);
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
