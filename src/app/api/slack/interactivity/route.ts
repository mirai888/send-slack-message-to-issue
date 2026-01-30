import crypto from "crypto";

export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: Request) {
  return new Response("Slack Interactivity API is running 🚀", { status: 200 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  // --- 署名検証（最低限） ---
  if (!verifySlack(req, rawBody)) {
    return new Response("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") || "{}");

  // Message Shortcut が押された
  if (
    payload.type === "message_action" &&
    payload.callback_id === "send_to_github_issue"
  ) {
    const text = payload.message?.text ?? "";
    const user = payload.user?.username ?? payload.user?.id;
    const channel = payload.channel?.name ?? payload.channel?.id;

    const body = formatIssueComment({
      text,
      user,
      channel,
    });

    // GitHub Issue に即コメント
    await postIssueComment(body);

    // Slackには即ACK
    return new Response("", { status: 200 });
  }

  return new Response("", { status: 200 });
}

/* ---------------- helpers ---------------- */

function verifySlack(req: Request, rawBody: string) {
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;

  const base = `v0:${ts}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET!)
    .update(base)
    .digest("hex");

  return `v0=${hmac}` === sig;
}

function formatIssueComment({
  text,
  user,
  channel,
}: {
  text: string;
  user: string;
  channel: string;
}) {
  const quoted = text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

  return `
## Slackから共有 🧵

**投稿者**: @${user}  
**チャンネル**: #${channel}

${quoted || "> （本文なし）"}
`.trim();
}

async function postIssueComment(body: string) {
  const res = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/issues/2813/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("GitHub error:", text);
    throw new Error("Failed to post comment");
  }
}
