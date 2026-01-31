This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 環境変数

以下の環境変数を設定してください：

### 必須
- `SLACK_BOT_TOKEN`: Slack Bot Token（`xoxb-` で始まる）
- `SLACK_SIGNING_SECRET`: Slack App の Signing Secret
- `GITHUB_TOKEN`: GitHub Personal Access Token または GitHub App Token
- `GITHUB_OWNER`: GitHub リポジトリのオーナー名
- `GITHUB_REPO`: GitHub リポジトリ名（Issue があるリポジトリ）

### オプション
- `GITHUB_ASSETS_REPO`: アセットを保存するリポジトリ名（デフォルト: `${GITHUB_REPO}-assets`）
- `GITHUB_ASSETS_BRANCH`: アセットリポジトリのブランチ名（デフォルト: `main`）

### アセットリポジトリについて

Slack のファイル（画像、PDF、Excel など）は、別のアセットリポジトリに保存されます。
アセットリポジトリは事前に作成しておく必要があります。

- リポジトリ名: `GITHUB_ASSETS_REPO` で指定（未指定の場合は `${GITHUB_REPO}-assets`）
- ブランチ: `GITHUB_ASSETS_BRANCH` で指定（未指定の場合は `main`）
- ファイルは `slack_files/{issueNumber}/{timestamp}_{random}_{filename}` の形式で保存されます

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
