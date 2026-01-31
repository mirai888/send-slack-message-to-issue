This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 環境変数

以下の環境変数を設定してください：

### 必須
- `SLACK_BOT_TOKEN`: Slack Bot Token（`xoxb-` で始まる）
- `SLACK_SIGNING_SECRET`: Slack App の Signing Secret
- `GITHUB_TOKEN`: GitHub Personal Access Token または GitHub App Token
  - **Classic Token の場合**: `repo` スコープが必要
  - **Fine-grained Token の場合**: 以下の権限が必要
    - `Contents`: Read and write（ファイルの読み書き）
    - `Issues`: Read and write（Issueコメントの投稿）
    - `Metadata`: Read only（リポジトリ情報の取得）
- `GITHUB_OWNER`: GitHub リポジトリのオーナー名（ユーザー名または組織名）
  - 例: `octocat`（個人アカウントの場合）
  - 例: `github`（組織アカウントの場合）
  - リポジトリURLが `https://github.com/{owner}/{repo}` の場合、`{owner}` の部分
- `GITHUB_REPO`: GitHub リポジトリ名（Issue があるリポジトリ）
  - 例: `my-project`
  - リポジトリURLが `https://github.com/{owner}/{repo}` の場合、`{repo}` の部分

### オプション
- `GITHUB_ASSETS_REPO`: アセットを保存するリポジトリ名（デフォルト: `GITHUB_REPO` と同じ = メインリポジトリ）
- `GITHUB_ASSETS_BRANCH`: アセットリポジトリのブランチ名（デフォルト: `main`）

### アセットリポジトリについて

Slack のファイル（画像、PDF、Excel など）は、GitHub リポジトリに保存されます。

**デフォルト動作（推奨）:**
- `GITHUB_ASSETS_REPO` を設定しない場合、**メインリポジトリ（`GITHUB_REPO`）に直接保存**されます
- 別リポジトリを作成する必要はありません
- ファイルは `slack_files/{issueNumber}/{timestamp}_{random}_{filename}` の形式で保存されます

**別リポジトリを使う場合:**
- `GITHUB_ASSETS_REPO` 環境変数で別のリポジトリ名を指定できます
- 例: `GITHUB_ASSETS_REPO=my-project-assets` と設定すると、`my-project-assets` リポジトリに保存されます
- 別リポジトリを使う場合は、事前にリポジトリを作成しておく必要があります

#### メインリポジトリを使う場合（デフォルト・推奨）

**何も設定する必要はありません！**

`GITHUB_ASSETS_REPO` を設定しない場合、自動的にメインリポジトリ（`GITHUB_REPO`）に保存されます。

- ✅ 別リポジトリを作成する必要がない
- ✅ 設定が簡単
- ✅ メインリポジトリにファイルがまとまる

#### 別リポジトリを使う場合

アセットを別リポジトリに保存したい場合のみ、以下の手順を実行してください。

##### 方法1: GitHub Web UI で作成

1. GitHub にログインして、[新しいリポジトリを作成](https://github.com/new) にアクセス
2. リポジトリ名を入力（例: `{GITHUB_REPO}-assets`）
3. リポジトリを **Private** または **Public** で作成
4. **「Initialize this repository with a README」はチェックしない**（空のリポジトリでOK）
5. 「Create repository」をクリック
6. 環境変数 `GITHUB_ASSETS_REPO` にリポジトリ名を設定

##### 方法2: GitHub CLI で作成

```bash
# GitHub CLI がインストールされている場合
gh repo create {GITHUB_REPO}-assets --private --clone=false

# 環境変数で指定
GITHUB_ASSETS_REPO={GITHUB_REPO}-assets
```

#### 注意事項

- アセットリポジトリ（メインリポジトリまたは別リポジトリ）は、GitHub Token が書き込み権限を持っている必要があります
- 別リポジトリを使う場合、リポジトリが存在しないと404エラーが発生します
- ブランチ名が `main` 以外の場合は、`GITHUB_ASSETS_BRANCH` 環境変数で指定してください

参考: [Slackの画像等のファイルを含めたメッセージをGitHubのIssueコメントとして同期する](https://zenn.dev/optimind/articles/slack-images-and-files-to-github-sync)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
