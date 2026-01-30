import { NextRequest, NextResponse } from 'next/server';
import { createGitHubClient } from '@/lib/github/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, issueNumber, comment } = body;

    if (!owner || !repo || !issueNumber || !comment) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, repo, issueNumber, comment' },
        { status: 400 }
      );
    }

    const githubClient = createGitHubClient();
    
    // GitHub Issueにコメントを追加
    const result = await githubClient.createIssueComment(
      owner,
      repo,
      issueNumber,
      comment
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error creating GitHub comment:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
