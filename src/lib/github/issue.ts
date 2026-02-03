export async function getIssue(issueNumber: string) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN is not set");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get issue: ${res.status} ${text}`);
  }

  const result = await res.json();
  return {
    number: result.number,
    title: result.title,
    url: result.html_url,
  };
}

export async function postIssueComment(
  issueNumber: string,
  body: string
) {
  console.log(`[D1] postIssueComment: 開始 - Issue #${issueNumber}`);
  
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN is not set");
  }
  console.log(`[D2] postIssueComment: 環境変数の確認完了 - ${owner}/${repo}`);

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  console.log(`[D3] postIssueComment: POSTリクエストを開始 - ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  console.log(`[D4] postIssueComment: POSTリクエスト完了 - status: ${res.status}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to post issue comment: ${res.status} ${text}`);
  }

  const result = await res.json();
  console.log(`[D5] postIssueComment: 完了 - comment ID: ${result.id}`);
  return result;
}
