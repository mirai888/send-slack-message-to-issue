export async function postIssueComment(
  issueNumber: string,
  body: string
) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo) {
    throw new Error(`GITHUB_OWNER or GITHUB_REPO is not set (owner: ${owner}, repo: ${repo})`);
  }

  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  
  console.info(`[Issue Comment] POST ${url}`);
  console.debug(`[Issue Comment] Body length: ${body.length} chars`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Issue Comment] GitHub API error: ${res.status} ${res.statusText}`);
    console.error(`[Issue Comment] Response: ${text}`);
    throw new Error(`Failed to post issue comment: ${res.status} ${res.statusText} - ${text.substring(0, 200)}`);
  }

  const result = await res.json();
  console.info(`[Issue Comment] Successfully posted comment to issue #${issueNumber}, comment ID: ${result.id}`);
  return result;
}
