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

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

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
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${text}`);
  }
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

    const owner = process.env.GITHUB_OWNER!;
    const repo = process.env.GITHUB_REPO!;
    const branch = "main";

    if (!owner || !repo) {
      throw new Error("GITHUB_OWNER or GITHUB_REPO is not set");
    }

    const fileDataBase64 = downloaded.buffer.toString("base64");
    const randomPrefix = Math.random().toString(36).slice(-8);
    const timestamp = Date.now();
    const path = `slack_files/${issueNumber}/${timestamp}_${randomPrefix}_${downloaded.filename}`;

    await createOrUpdateFileContents(
      owner,
      repo,
      path,
      fileDataBase64,
      `Add file ${downloaded.filename} for issue #${issueNumber}`
    );

    const repoUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${encodeURIComponent(path)}`;
    const previewUrl = `https://github.com/${owner}/${repo}/raw/${branch}/${encodeURIComponent(path)}`;

    return {
      filename: downloaded.filename,
      url: previewUrl, // 画像プレビュー用（raw URL）
      repoUrl, // リポジトリ内のファイルURL
      mimetype: downloaded.mimetype,
      isImage: downloaded.mimetype.startsWith("image/"),
    };
  } catch (error) {
    return {
      filename,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
