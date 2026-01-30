import crypto from "crypto";

export async function verifySlackRequest(req: Request, rawBody: string) {
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;

  // リプレイ攻撃対策（5分）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 60 * 5) return false;

  const base = `v0:${ts}:${rawBody}`;
  const secret = process.env.SLACK_SIGNING_SECRET!;
  const hmac = crypto.createHmac("sha256", secret).update(base).digest("hex");
  const expected = `v0=${hmac}`;

  // timingSafeEqual
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
