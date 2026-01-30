export const runtime = "nodejs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get("payload") || "{}");

  const query = payload.value ?? "";
  const options = await searchIssues(query);

  return new Response(
    JSON.stringify({ options }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

async function searchIssues(query: string) {
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;

  const q = query.match(/#?(\d+)/)
    ? `repo:${owner}/${repo} is:issue number:${RegExp.$1}`
    : `repo:${owner}/${repo} is:issue in:title ${query}`;

  const res = await fetch(
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) return [];

  const json = await res.json();

  return json.items.map((it: any) => ({
    text: {
      type: "plain_text",
      text: `#${it.number} ${it.title}`.slice(0, 75),
    },
    value: String(it.number),
  }));
}
