/** Posts an email to the OpenHelm website's newsletter endpoint.
 *  The website holds the Resend API key so it never lives in the desktop binary. */
const WEBSITE_URL =
  process.env.OPENHELM_WEBSITE_URL ?? 'https://openhelm.dev';

export async function subscribeToNewsletter(email: string): Promise<void> {
  const res = await fetch(`${WEBSITE_URL}/api/newsletter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Newsletter subscribe failed (${res.status}): ${body}`);
  }
}
