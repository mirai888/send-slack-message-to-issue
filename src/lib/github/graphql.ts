/**
 * GitHub GraphQL API クライアント
 * 
 * repositoryId / issueId の取得と uploadIssueCommentAsset mutation を提供
 */

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    type?: string;
    path?: string[];
  }>;
}

/**
 * GraphQL クエリ/ミューテーションを実行
 */
async function executeGraphQL<T>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} ${text}`);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors) {
    const errorMessages = result.errors.map((e) => e.message).join(", ");
    throw new Error(`GraphQL errors: ${errorMessages}`);
  }

  if (!result.data) {
    throw new Error("GraphQL response has no data");
  }

  return result.data;
}

/**
 * repositoryId を取得
 * owner/repo から repositoryId (ID型) を取得する
 */
export async function getRepositoryId(
  owner: string,
  repo: string
): Promise<string> {
  const query = `
    query GetRepositoryId($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
      }
    }
  `;

  interface Response {
    repository: {
      id: string;
    } | null;
  }

  const data = await executeGraphQL<Response>(query, { owner, repo });

  if (!data.repository) {
    throw new Error(`Repository not found: ${owner}/${repo}`);
  }

  return data.repository.id;
}

/**
 * issueId を取得
 * repositoryId と issueNumber から issueId (ID型) を取得する
 */
export async function getIssueId(
  repositoryId: string,
  issueNumber: number
): Promise<string> {
  const query = `
    query GetIssueId($repositoryId: ID!, $issueNumber: Int!) {
      node(id: $repositoryId) {
        ... on Repository {
          issue(number: $issueNumber) {
            id
          }
        }
      }
    }
  `;

  interface Response {
    node: {
      issue: {
        id: string;
      } | null;
    } | null;
  }

  const data = await executeGraphQL<Response>(query, {
    repositoryId,
    issueNumber,
  });

  if (!data.node || !data.node.issue) {
    throw new Error(
      `Issue not found: #${issueNumber} in repository ${repositoryId}`
    );
  }

  return data.node.issue.id;
}

/**
 * uploadIssueCommentAsset mutation を実行
 * 
 * この mutation は、ファイルのバイナリデータをbase64エンコードして
 * Issue コメントで使用できるアセットとして登録する
 * 
 * 注意: GitHubの実際のAPI仕様では、このmutationがファイルのバイナリデータを
 * 直接受け取る可能性があるため、base64エンコードして渡す
 * 
 * @param repositoryId - リポジトリのID（GraphQL ID型）
 * @param issueId - IssueのID（GraphQL ID型）
 * @param fileData - ファイルのバイナリデータ（base64エンコード済み）
 * @param assetName - アセット名（ファイル名）
 * @param contentType - ファイルのContent-Type
 * @returns アセットのURL（Issueコメントで使用可能）
 */
export async function uploadIssueCommentAsset(
  repositoryId: string,
  issueId: string,
  fileData: string, // base64エンコードされたファイルデータ
  assetName: string,
  contentType: string
): Promise<string> {
  const mutation = `
    mutation UploadIssueCommentAsset(
      $repositoryId: ID!
      $issueId: ID!
      $fileData: String!
      $assetName: String!
      $contentType: String!
    ) {
      uploadIssueCommentAsset(
        repositoryId: $repositoryId
        issueId: $issueId
        fileData: $fileData
        assetName: $assetName
        contentType: $contentType
      ) {
        assetUrl
      }
    }
  `;

  interface Response {
    uploadIssueCommentAsset: {
      assetUrl: string;
    };
  }

  const data = await executeGraphQL<Response>(mutation, {
    repositoryId,
    issueId,
    fileData,
    assetName,
    contentType,
  });

  return data.uploadIssueCommentAsset.assetUrl;
}
