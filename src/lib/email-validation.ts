import type { UsageType } from "@openhelm/shared";

/** Common free/personal email domains that are not acceptable for business use */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tutamail.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.net",
  "fastmail.com",
  "hey.com",
]);

/** Known education domain suffixes */
const EDUCATION_SUFFIXES = [
  ".edu",
  ".ac.uk",
  ".edu.au",
  ".ac.nz",
  ".edu.nz",
  ".ac.za",
  ".edu.za",
  ".ac.in",
  ".edu.in",
  ".edu.sg",
  ".ac.sg",
  ".edu.hk",
  ".edu.cn",
  ".edu.br",
  ".edu.mx",
  ".edu.ar",
  ".edu.co",
  ".edu.pe",
  ".edu.tr",
  ".edu.eu.org",
  ".edu.pl",
  ".uni-",   // German universities
  ".hs-",    // German Hochschulen
];

function getDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function isEducationEmail(email: string): boolean {
  const domain = getDomain(email);
  if (!domain) return false;

  // Direct suffix match
  if (EDUCATION_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return true;

  // Subdomain match e.g. student.ox.ac.uk
  return EDUCATION_SUFFIXES.some((suffix) => domain.includes(suffix));
}

function isBusinessEmail(email: string): boolean {
  const domain = getDomain(email);
  return !FREE_EMAIL_DOMAINS.has(domain);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns true if the email looks like a corporate/work email
 * (not a free personal provider, not an institutional education address) */
export function isCommercialEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!EMAIL_REGEX.test(trimmed)) return false;
  const domain = getDomain(trimmed);
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.has(domain) && !isEducationEmail(trimmed);
}

/** Validate an email address for a given usage type */
export function validateEmailForUsageType(
  email: string,
  usageType: UsageType,
): { valid: boolean; error?: string } {
  const trimmed = email.trim();

  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: "Please enter a valid email address." };
  }

  if (usageType === "business") {
    if (!isBusinessEmail(trimmed)) {
      return {
        valid: false,
        error:
          "Please use your work email address. Free email providers (Gmail, Hotmail, etc.) are not accepted for business accounts.",
      };
    }
  }

  if (usageType === "education") {
    if (!isEducationEmail(trimmed)) {
      return {
        valid: false,
        error:
          "Please use your institutional email address (e.g. .edu, .ac.uk). If your institution uses a non-standard domain, contact us.",
      };
    }
  }

  return { valid: true };
}
