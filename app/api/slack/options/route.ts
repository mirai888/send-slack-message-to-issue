export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  // 本来ここも署名検証する（MVPでは interactivity 側のみでも可だが推奨は検証）
  const form = new URLSearchParams(rawBody);
  const payload = JSON.parse(form.get("payload") || "{}");

  const q = payload.value ?? "";
  const options = await searchIssues(q);

  return new Response(JSON.stringify({ options }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function searchIssues(q: string) {
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;

  // #1234 で来たら番号優先
  const num = q.match(/#?(\d+)/)?.[1];
  const query = num
    ? `repo:${owner}/${repo} is:issue number:${num}`
    : `repo:${owner}/${repo} is:issue in:title ${q}`;

  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=20`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "slack-to-issue-nextjs",
    },
  });
  if (!res.ok) return [];

  const json = await res.json();
  const items = json.items ?? [];

  return items.map((it: { number: number; title: string }) => ({
    text: { type: "plain_text", text: `#${it.number} ${it.title}`.slice(0, 75) },
    value: String(it.number),
  }));
}
