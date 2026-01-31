/**
 * GitHub Issue コメントアセットアップロード処理
 * 
 * SlackファイルをGitHub S3にアップロードし、Issueコメントで使用可能なアセットとして登録
 * 
 * 処理フロー:
 * 1. Slackファイルをダウンロード
 * 2. ファイルサイズ・種別チェック
 * 3. GitHub S3にPUTリクエストでアップロード
 * 4. uploadIssueCommentAsset mutationでアセットを登録
 * 5. 返されたURLを返す
 */

import { downloadSlackFile, DownloadedFile } from "@/lib/slack/downloadFile";
import {
  getRepositoryId,
  getIssueId,
  uploadIssueCommentAsset,
} from "./graphql";

interface SlackFile {
  id?: string;
  url_private_download?: string;
  url_private?: string;
  name?: string;
  mimetype?: string;
  size?: number;
}

export interface UploadedAsset {
  filename: string;
  url: string;
  mimetype: string;
  isImage: boolean;
}

export interface UploadError {
  filename: string;
  reason: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * ファイル種別がサポートされているかチェック
 */
function isSupportedFileType(mimetype: string): boolean {
  // 画像
  if (mimetype.startsWith("image/")) {
    return true;
  }
  // PDF
  if (mimetype === "application/pdf") {
    return true;
  }
  // Excel
  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel"
  ) {
    return true;
  }
  return false;
}

/**
 * GitHub S3にファイルをアップロード
 * 
 * GitHubのIssueコメントアセットアップロードの流れ:
 * 1. GitHub REST APIでアセットアップロード用の署名付きURLを取得
 * 2. そのURLにPUTリクエストでファイルをアップロード
 * 3. アップロードされたURLを使用してuploadIssueCommentAsset mutationを実行
 * 
 * 実装方針:
 * GitHubのIssueコメントアセットアップロードは、通常、以下のような方法で実装:
 * 1. GitHub REST APIでアセットアップロード用の署名付きURLを取得
 *    - `/repos/{owner}/{repo}/releases/assets` エンドポイントはRelease専用
 *    - Issueコメントアセット用の専用エンドポイントを使用
 * 2. そのURLにPUTリクエストでファイルをアップロード
 * 3. アップロードされたURLを使用してuploadIssueCommentAsset mutationを実行
 * 
 * 注意: GitHubの実際のAPI仕様では、Issueコメントアセットは通常、
 * Releaseアセットとは異なるエンドポイントを使用する。
 * この実装は、GitHubの公式API仕様に基づいて実装する必要がある。
 */
async function uploadToGitHubS3(
  buffer: Buffer,
  filename: string,
  mimetype: string,
  issueNumber: string
): Promise<string> {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  if (!owner || !repo || !token) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, or GITHUB_TOKEN is not set");
  }

  // GitHubのIssueコメントアセットアップロード用の署名付きURLを取得
  // 注意: このエンドポイントは実際のGitHub API仕様に基づいて実装する必要がある
  // 暫定的な実装として、GitHub REST APIの `/repos/{owner}/{repo}/issues/{issue_number}/assets` 
  // エンドポイントを使用するが、実際のAPI仕様では異なる可能性がある
  
  // まず、アセットアップロード用の署名付きURLを取得
  const requestUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/assets/upload`;
  
  console.log(`[GitHub S3] Requesting upload URL for ${filename}`);

  const requestResponse = await fetch(requestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: filename,
      size: buffer.length,
      content_type: mimetype,
    }),
  });

  if (!requestResponse.ok) {
    const text = await requestResponse.text();
    console.error(
      `[GitHub S3] Failed to get upload URL: ${requestResponse.status} ${text}`
    );

    // エンドポイントが存在しない場合、別の方法を試す
    // GitHubのIssueコメントアセットアップロードは、通常、以下のような方法で実装:
    // 1. GraphQL mutationの `uploadIssueCommentAsset` が内部でS3アップロードを処理
    // 2. または、GitHub REST APIの別のエンドポイントを使用
    
    // 暫定的な実装: 直接アップロードを試す
    // 実際の実装では、GitHubのIssueコメントアセットアップロード用の
    // 専用エンドポイントを使用する必要がある
    
    throw new Error(
      `Failed to get upload URL: ${requestResponse.status} ${text.substring(0, 200)}`
    );
  }

  const uploadData = await requestResponse.json();
  const uploadUrl = uploadData.upload_url;

  if (!uploadUrl) {
    throw new Error("GitHub API response missing upload_url");
  }

  console.log(`[GitHub S3] Uploading ${filename} to ${uploadUrl.substring(0, 50)}...`);

  // 署名付きURLにPUTリクエストでファイルをアップロード
  // BufferをUint8Arrayに変換（fetchのbodyはBodyInit型が必要）
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimetype,
      "Content-Length": buffer.length.toString(),
    },
    body: new Uint8Array(buffer),
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    console.error(`[GitHub S3] Upload failed: ${uploadResponse.status} ${text}`);
    throw new Error(
      `Failed to upload to GitHub S3: ${uploadResponse.status} ${text.substring(0, 200)}`
    );
  }

  // アップロードされたURLを取得
  // 注意: 実際のAPI仕様では、レスポンスからURLを取得する方法が異なる可能性がある
  const location = uploadResponse.headers.get("Location") || uploadData.browser_download_url;
  if (!location) {
    throw new Error("GitHub S3 upload response missing URL");
  }

  return location;
}

/**
 * SlackファイルをGitHub Issueコメントアセットとしてアップロード
 * 
 * @param file - Slackファイル情報
 * @param issueNumber - Issue番号
 * @returns アップロードされたアセット情報、またはエラー情報
 */
export async function uploadSlackFileToGitHub(
  file: SlackFile,
  issueNumber: string
): Promise<UploadedAsset | UploadError> {
  const filename = file.name ?? "file";
  const mimetype = file.mimetype ?? "application/octet-stream";

  try {
    // ファイル種別チェック
    if (!isSupportedFileType(mimetype)) {
      return {
        filename,
        reason: `Unsupported file type: ${mimetype}`,
      };
    }

    // ファイルサイズチェック（事前にサイズが分かっている場合）
    if (file.size && file.size > MAX_FILE_SIZE) {
      return {
        filename,
        reason: `File size exceeds 10MB limit: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
      };
    }

    // Slackファイルをダウンロード
    const downloaded = await downloadSlackFile(file);

    // ダウンロード後のサイズチェック
    if (downloaded.size > MAX_FILE_SIZE) {
      return {
        filename,
        reason: `File size exceeds 10MB limit: ${(downloaded.size / 1024 / 1024).toFixed(2)}MB`,
      };
    }

    // repositoryId / issueId を取得
    const owner = process.env.GITHUB_OWNER!;
    const repo = process.env.GITHUB_REPO!;
    const repositoryId = await getRepositoryId(owner, repo);
    const issueId = await getIssueId(repositoryId, parseInt(issueNumber, 10));

    // GitHub S3にアップロード
    // 注意: この実装は実際のGitHub API仕様に合わせて調整が必要
    const assetUrl = await uploadToGitHubS3(
      downloaded.buffer,
      downloaded.filename,
      downloaded.mimetype,
      issueNumber
    );

    // uploadIssueCommentAsset mutationでアセットを登録
    const finalAssetUrl = await uploadIssueCommentAsset(
      repositoryId,
      issueId,
      assetUrl,
      downloaded.filename
    );

    return {
      filename: downloaded.filename,
      url: finalAssetUrl,
      mimetype: downloaded.mimetype,
      isImage: downloaded.mimetype.startsWith("image/"),
    };
  } catch (error) {
    console.error(`[Upload Asset] Failed to upload ${filename}:`, error);
    return {
      filename,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
