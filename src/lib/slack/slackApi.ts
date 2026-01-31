export async function callSlackApi(method: string, body: unknown) {
  console.log(`[Slack API] Calling ${method} with body:`, JSON.stringify(body));
  
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!json.ok) {
    const errorMessage = json.error || "Unknown error";
    console.error(`[Slack API] ${method} failed:`, {
      error: errorMessage,
      response: json,
    });
    throw new Error(`Slack API error (${method}): ${errorMessage}`);
  }

  return json;
}
