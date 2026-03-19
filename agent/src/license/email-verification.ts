import type {
  UsageType,
  EmailVerificationResult,
  EmailVerificationStatus,
} from "@openhelm/shared";

const WEBSITE_URL =
  process.env.OPENHELM_WEBSITE_URL ?? "https://openhelm.dev";

/** Request an email verification link from the website API */
export async function requestEmailVerification(
  email: string,
  usageType: UsageType | undefined,
  newsletterOptIn: boolean,
): Promise<EmailVerificationResult> {
  const body: Record<string, unknown> = { email, newsletterOptIn };
  if (usageType !== undefined) body.usageType = usageType;
  const res = await fetch(`${WEBSITE_URL}/api/license/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Email verification request failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<EmailVerificationResult>;
}

/** Poll the website API to check if a verification token has been clicked */
export async function checkEmailVerification(
  token: string,
): Promise<EmailVerificationStatus> {
  const url = new URL(`${WEBSITE_URL}/api/license/check-email`);
  url.searchParams.set("token", token);

  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Email verification check failed (${res.status})`);
  }

  return res.json() as Promise<EmailVerificationStatus>;
}
