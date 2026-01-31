/**
 * GitHub Issue コメントアセットアップロード処理
 * 
 * Vercel Blobに保存されたファイルをGitHubリポジトリにコミットし、Issueコメントで使用可能なアセットとして登録
 * 
 * 処理フロー:
 * 1. Vercel Blob URLからファイルをダウンロード
 * 2. ファイルサイズ・種別チェック
 * 3. アセットリポジトリにファイルをコミット（createOrUpdateFileContents）
 * 4. raw URLを返す（Issueコメントで使用可能）
 * 
 * 参考: https://zenn.dev/optimind/articles/slack-images-and-files-to-github-sync
 */

interface BlobFileInfo {
  url: string; // Vercel Blob URL
  filename: string;
  mimetype: string;
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
  console.log(`[B1] createOrUpdateFileContents: 開始 - ${owner}/${repo}/${path}`);
  
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  console.log("[B2] createOrUpdateFileContents: GitHub Tokenの確認完了");

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  console.log(`[B3] createOrUpdateFileContents: PUTリクエストを開始 - ${url}`);

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
  console.log(`[B4] createOrUpdateFileContents: PUTリクエスト完了 - status: ${response.status}`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${text}`);
  }
  
  console.log("[B5] createOrUpdateFileContents: 完了");
}

/**
 * Vercel Blobに保存されたファイルをGitHub Issueコメントアセットとしてアップロード
 * 
 * @param fileInfo - Vercel Blobに保存されたファイル情報
 * @param issueNumber - Issue番号
 * @returns アップロードされたアセット情報、またはエラー情報
 */
export async function uploadBlobFileToGitHub(
  fileInfo: BlobFileInfo,
  issueNumber: string
): Promise<UploadedAsset | UploadError> {
  console.log(`[C1] uploadBlobFileToGitHub: 開始 - ${fileInfo.filename}`);
  
  const filename = fileInfo.filename;
  const mimetype = fileInfo.mimetype;

  try {
    console.log(`[C2] uploadBlobFileToGitHub: ファイル種別チェック - ${mimetype}`);
    if (!isSupportedFileType(mimetype)) {
      return {
        filename,
        reason: `Unsupported file type: ${mimetype}`,
      };
    }

    console.log(`[C3] uploadBlobFileToGitHub: Vercel Blobからファイルのダウンロードを開始 - ${fileInfo.url}`);
    const res = await fetch(fileInfo.url);
    
    if (!res.ok) {
      throw new Error(`Failed to download from Vercel Blob: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`[C4] uploadBlobFileToGitHub: ダウンロード完了 - ${buffer.length} bytes`);

    console.log(`[C5] uploadBlobFileToGitHub: ファイルサイズチェック`);
    if (buffer.length > MAX_FILE_SIZE) {
      return {
        filename,
        reason: `File size exceeds 10MB limit: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`,
      };
    }

    const owner = process.env.GITHUB_OWNER!;
    const repo = process.env.GITHUB_REPO!;
    const branch = "main";

    if (!owner || !repo) {
      throw new Error("GITHUB_OWNER or GITHUB_REPO is not set");
    }
    console.log(`[C6] uploadBlobFileToGitHub: 環境変数の確認完了 - ${owner}/${repo}`);

    console.log(`[C7] uploadBlobFileToGitHub: base64エンコードを開始`);
    const fileDataBase64 = buffer.toString("base64");
    console.log(`[C8] uploadBlobFileToGitHub: base64エンコード完了 - ${fileDataBase64.length} chars`);

    const randomPrefix = Math.random().toString(36).slice(-8);
    const timestamp = Date.now();
    const path = `slack_files/${issueNumber}/${timestamp}_${randomPrefix}_${filename}`;
    console.log(`[C9] uploadBlobFileToGitHub: ファイルパスを生成 - ${path}`);

    console.log(`[C10] uploadBlobFileToGitHub: GitHubへのアップロードを開始`);
    await createOrUpdateFileContents(
      owner,
      repo,
      path,
      fileDataBase64,
      `Add file ${filename} for issue #${issueNumber}`
    );
    console.log(`[C11] uploadBlobFileToGitHub: GitHubへのアップロード完了`);

    const repoUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${encodeURIComponent(path)}`;
    const previewUrl = `https://github.com/${owner}/${repo}/raw/${branch}/${encodeURIComponent(path)}`;
    console.log(`[C12] uploadBlobFileToGitHub: URLを生成完了`);

    console.log(`[C13] uploadBlobFileToGitHub: 完了`);
    return {
      filename,
      url: previewUrl,
      repoUrl,
      mimetype,
      isImage: mimetype.startsWith("image/"),
    };
  } catch (error) {
    console.log(`[C-ERROR] uploadBlobFileToGitHub: エラー発生 - ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      filename,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
