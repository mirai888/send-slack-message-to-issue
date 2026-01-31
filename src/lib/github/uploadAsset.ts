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

import { downloadSlackFile } from "@/lib/slack/downloadFile";
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
 * ファイルをbase64エンコード
 * 
 * GraphQL mutationでファイルデータを渡すためにbase64エンコードする
 */
function encodeFileToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
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

    // ファイルをbase64エンコード
    // GraphQL mutationでファイルデータを渡すためにbase64エンコードする
    const fileDataBase64 = encodeFileToBase64(downloaded.buffer);
    console.log(`[Upload Asset] Encoded ${downloaded.filename} to base64 (${fileDataBase64.length} chars)`);

    // uploadIssueCommentAsset mutationでアセットを登録
    // このmutationが内部でS3アップロードを処理する
    console.info(`[GitHub Upload] Starting upload for ${downloaded.filename} (${downloaded.mimetype})`);
    const finalAssetUrl = await uploadIssueCommentAsset(
      repositoryId,
      issueId,
      fileDataBase64,
      downloaded.filename,
      downloaded.mimetype
    );
    console.info(`[GitHub Upload] Upload completed for ${downloaded.filename}, URL: ${finalAssetUrl}`);

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
