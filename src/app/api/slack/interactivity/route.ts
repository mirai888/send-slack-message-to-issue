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
  const state = payload.view.state.values;
  const issueNumber =
    state.issue.issue_select.selected_option.value;

  const meta = JSON.parse(payload.view.private_metadata);
  const slackFiles = meta.files ?? [];

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
  for (const file of slackFiles) {
    try {
      let fileInfo = file;
      if (!file.url_private_download && !file.url_private && file.id) {
        const fileResponse = await callSlackApi("files.info", { file: file.id });
        fileInfo = fileResponse.file;
      }

      const result = await uploadSlackFileToGitHub(fileInfo, issueNumber);

      if ("url" in result) {
        uploadedFiles.push({
          filename: result.filename,
          url: result.url,
          mimetype: result.mimetype,
        });
      } else {
        uploadErrors.push({
          filename: result.filename,
          reason: result.reason,
        });
      }
    } catch (e) {
      const filename = file.name || file.id || "unknown";
      uploadErrors.push({
        filename,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
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
