import { verifySlackRequest } from "@/lib/slack/verify";

export const runtime = "nodejs"; // crypto使うため

export async function POST(req: Request) {
  const rawBody = await req.text();
  const ok = await verifySlackRequest(req, rawBody);
  if (!ok) return new Response("invalid signature", { status: 401 });

  const form = new URLSearchParams(rawBody);
  const payload = JSON.parse(form.get("payload") || "{}");

  // ① メッセージショートカットが押された
  if (payload.type === "message_action" && payload.callback_id === "send_to_github_issue") {
    const triggerId = payload.trigger_id;
    const message = payload.message;
    const channel = payload.channel?.name ?? payload.channel?.id;
    const user = payload.user?.username ?? payload.user?.id;

    // view.private_metadata に必要情報を詰めて submit で使う
    const privateMetadata = JSON.stringify({
      slack: {
        user,
        channel,
        ts: message?.ts,
        text: message?.text ?? "",
        permalink: payload.message?.permalink, // 無いこともある
      },
    });

    const view = {
      type: "modal",
      callback_id: "send_to_github_issue_submit",
      private_metadata: privateMetadata,
      title: { type: "plain_text", text: "Issueに送信" },
      submit: { type: "plain_text", text: "送信" },
      close: { type: "plain_text", text: "キャンセル" },
      blocks: [
        {
          type: "input",
          block_id: "issue",
          label: { type: "plain_text", text: "Issue" },
          element: {
            type: "external_select",
            action_id: "issue_select",
            placeholder: { type: "plain_text", text: "番号 or タイトルで検索" },
            min_query_length: 1,
          },
        },
        {
          type: "input",
          optional: true,
          block_id: "extra",
          label: { type: "plain_text", text: "追加コメント（任意）" },
          element: { type: "plain_text_input", action_id: "extra_text", multiline: true },
        },
      ],
    };

    await slackApi("views.open", { trigger_id: triggerId, view });

    // Slackはここで200を返せばOK
    return new Response("", { status: 200 });
  }

  // ② external_select の候補要求
  if (payload.type === "block_suggestion") {
    // Slackは options endpoint に投げる構成にもできるけど、
    // ここで返してもOK。今回は options endpoint を使う想定なので案内だけ。
    return new Response(JSON.stringify({ options: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // ③ モーダル submit
  if (payload.type === "view_submission" && payload.view?.callback_id === "send_to_github_issue_submit") {
    // Slackは「すぐACK」→ GitHub投稿は別APIでも良いが、
    // MVPはここで同期で投げちゃう（小さければ間に合う）。
    const selected = payload.view.state.values.issue.issue_select.selected_option;
    const issueNumber = selected?.value;
    const extra = payload.view.state.values.extra?.extra_text?.value ?? "";

    const meta = JSON.parse(payload.view.private_metadata || "{}");
    const slackText = meta?.slack?.text ?? "";
    const slackUser = meta?.slack?.user ?? "";
    const slackChannel = meta?.slack?.channel ?? "";
    const slackTs = meta?.slack?.ts ?? "";

    const body = formatIssueComment({
      slackText,
      slackUser,
      slackChannel,
      slackTs,
      extra,
    });

    await githubCreateComment(issueNumber, body);

    // view_submission は空bodyでOK（エラー表示したい場合は response_action を返す）
    return new Response(JSON.stringify({ response_action: "clear" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("", { status: 200 });
}

async function slackApi(method: string, payload: unknown) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack API error: ${method} ${JSON.stringify(json)}`);
}

function formatIssueComment(params: {
  slackText: string;
  slackUser: string;
  slackChannel: string;
  slackTs: string;
  extra: string;
}) {
  const { slackText, slackUser, slackChannel, slackTs, extra } = params;
  const quoted = slackText
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

  return [
    `## Slackから共有 🧵`,
    ``,
    `**投稿者**: @${slackUser}`,
    `**チャンネル**: #${slackChannel}`,
    `**timestamp**: ${slackTs}`,
    ``,
    extra ? `### 追加コメント\n${extra}\n` : "",
    `### Slack本文`,
    quoted || "> （本文なし）",
    ``,
  ].join("\n");
}

async function githubCreateComment(issueNumber: string, body: string) {
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "slack-to-issue-nextjs",
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub comment failed: ${res.status} ${text}`);
  }
}
