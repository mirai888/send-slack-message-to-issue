/**
 * GitHub Issue コメントアセットアップロード処理
 * 
 * Slackファイルを別のアセットリポジトリにコミットし、Issueコメントで使用可能なアセットとして登録
 * 
 * 処理フロー:
 * 1. Slackファイルをダウンロード
 * 2. ファイルサイズ・種別チェック
 * 3. アセットリポジトリにファイルをコミット（createOrUpdateFileContents）
 * 4. raw URLを返す（Issueコメントで使用可能）
 * 
 * 参考: https://zenn.dev/optimind/articles/slack-images-and-files-to-github-sync
 */

import { downloadSlackFile } from "@/lib/slack/downloadFile";

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
  url: string; // raw URL（画像プレビュー用）
  repoUrl: string; // リポジトリ内のファイルURL
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
 * GitHub REST APIでファイルをコミット
 * 
 * @param owner - リポジトリオーナー
 * @param repo - リポジトリ名
 * @param path - ファイルパス
 * @param content - base64エンコードされたファイル内容
 * @param message - コミットメッセージ
 */
async function createOrUpdateFileContents(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  // リポジトリの存在確認はスキップ（直接アップロードを試行し、エラー時に詳細なメッセージを表示）
  // Serverless環境で存在確認のfetchが詰まる可能性があるため

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  console.info(`[GitHub Upload] PUT ${url}`);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content,
      // 既存ファイルがある場合はshaが必要だが、今回は新規作成のみ
      // 必要に応じて既存ファイルのshaを取得して更新も可能
    }),
  });

  if (!response.ok) {
    let errorText = "";
    try {
      const errorJson = await response.json();
      errorText = errorJson.message || JSON.stringify(errorJson);
    } catch {
      errorText = await response.text().catch(() => "");
    }
    
    let errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
    
    if (response.status === 404) {
      errorMessage += ` - Repository ${owner}/${repo} not found or you don't have access.`;
      errorMessage += `\nPlease ensure:`;
      errorMessage += `\n  1. The repository exists`;
      errorMessage += `\n  2. Your GitHub token has access to the repository`;
    } else if (response.status === 403) {
      errorMessage += ` - Access denied.`;
      errorMessage += `\n\n⚠️ IMPORTANT: To upload files to GitHub, your token needs proper permissions.`;
      errorMessage += `\n\nRequired permissions:`;
      errorMessage += `\n\nFor Classic Personal Access Tokens:`;
      errorMessage += `\n  ✅ 'repo' scope (Full control of private repositories) - REQUIRED for file uploads`;
      errorMessage += `\n  ✅ 'issues' scope (Read and Write access to issues) - Already have`;
      errorMessage += `\n\nFor Fine-grained Personal Access Tokens:`;
      errorMessage += `\n  ✅ 'Contents': Read and write (ファイルの読み書きに必要)`;
      errorMessage += `\n  ✅ 'Issues': Read and write (Issueコメントの投稿に必要)`;
      errorMessage += `\n  ✅ 'Metadata': Read only (リポジトリ情報の取得に必要)`;
      errorMessage += `\n\nTo fix this:`;
      errorMessage += `\n  1. Go to GitHub Settings > Developer settings > Personal access tokens`;
      errorMessage += `\n  2. Edit your token:`;
      errorMessage += `\n     - Classic Token: Add 'repo' scope`;
      errorMessage += `\n     - Fine-grained Token: Add 'Contents' permission (Read and write)`;
      errorMessage += `\n  3. Make sure the token has access to the repository: ${owner}/${repo}`;
      errorMessage += `\n  4. Update GITHUB_TOKEN environment variable with the new token`;
      errorMessage += `\n\nNote: If you can't add required permissions due to organization policies,`;
      errorMessage += `\n  you may need to use a GitHub App instead of a Personal Access Token.`;
    } else if (response.status === 422) {
      errorMessage += ` - Unprocessable Entity.`;
      errorMessage += `\nThis usually means the file path is invalid or the branch doesn't exist.`;
    }
    
    errorMessage += `\n\nResponse: ${errorText.substring(0, 300)}`;
    
    console.error(`[GitHub Upload] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  const result = await response.json();
  console.info(`[GitHub Upload] Successfully uploaded file, commit SHA: ${result.commit.sha}`);
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

    // 環境変数の取得
    const owner = process.env.GITHUB_OWNER!;
    const mainRepo = process.env.GITHUB_REPO;
    // GITHUB_ASSETS_REPO が指定されていない場合は、メインリポジトリを使用
    const assetsRepo = mainRepo;
    const assetsBranch = "main";

    if (!owner) {
      throw new Error("GITHUB_OWNER is not set");
    }

    if (!assetsRepo) {
      throw new Error(
        "GITHUB_REPO is not set. " +
        "Please set GITHUB_REPO environment variable, or set GITHUB_ASSETS_REPO to use a separate repository."
      );
    }

    // 使用するリポジトリをログに出力（デバッグ用）
    if (process.env.GITHUB_ASSETS_REPO) {
      console.info(
        `[Upload Asset] Using separate assets repository: ${owner}/${assetsRepo} (branch: ${assetsBranch})`
      );
      console.info(
        `[Upload Asset] Note: GITHUB_ASSETS_REPO is set. To use main repository, remove GITHUB_ASSETS_REPO environment variable.`
      );
    } else {
      console.info(
        `[Upload Asset] Using main repository: ${owner}/${assetsRepo} (branch: ${assetsBranch})`
      );
    }

    // ファイルをbase64エンコード
    const fileDataBase64 = downloaded.buffer.toString("base64");
    console.info(
      `[Upload Asset] Encoded ${downloaded.filename} to base64 (${fileDataBase64.length} chars)`
    );

    // ファイルパスの生成（重複を避けるためランダムプレフィックスを追加）
    const randomPrefix = Math.random().toString(36).slice(-8);
    const timestamp = Date.now();
    const path = `slack_files/${issueNumber}/${timestamp}_${randomPrefix}_${downloaded.filename}`;

    // アセットリポジトリにファイルをコミット
    console.info(
      `[GitHub Upload] Starting upload for ${downloaded.filename} (${downloaded.mimetype}) to ${owner}/${assetsRepo}`
    );
    await createOrUpdateFileContents(
      owner,
      assetsRepo,
      path,
      fileDataBase64,
      `Add file ${downloaded.filename} for issue #${issueNumber}`
    );

    // raw URLとリポジトリURLを生成
    const repoUrl = `https://github.com/${owner}/${assetsRepo}/blob/${assetsBranch}/${encodeURIComponent(path)}`;
    const previewUrl = `https://github.com/${owner}/${assetsRepo}/raw/${assetsBranch}/${encodeURIComponent(path)}`;

    console.info(
      `[GitHub Upload] Upload completed for ${downloaded.filename}, URL: ${previewUrl}`
    );

    return {
      filename: downloaded.filename,
      url: previewUrl, // 画像プレビュー用（raw URL）
      repoUrl, // リポジトリ内のファイルURL
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
