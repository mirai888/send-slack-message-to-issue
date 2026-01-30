/**
 * GitHub APIクライアントの作成と管理
 */

interface GitHubClient {
  createIssueComment: (
    owner: string,
    repo: string,
    issueNumber: number,
    comment: string
  ) => Promise<any>;
}

/**
 * GitHub APIクライアントを作成する
 * @returns GitHubClientインスタンス
 */
export function createGitHubClient(): GitHubClient {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN is not set');
  }

  const baseUrl = 'https://api.github.com';

  return {
    async createIssueComment(
      owner: string,
      repo: string,
      issueNumber: number,
      comment: string
    ) {
      const url = `${baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          body: comment,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} ${error}`);
      }

      return await response.json();
    },
  };
}
