import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, MailCheck, RefreshCw } from "lucide-react";
import * as api from "@/lib/api";

interface EmailStepProps {
  onNext: (email: string) => void;
}

const POLL_INTERVAL_MS = 3000;
const RESEND_COOLDOWN_S = 60;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailStep({ onNext }: EmailStepProps) {
  const [email, setEmail] = useState("");
  const [newsletterOptIn, setNewsletterOptIn] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [pollError, setPollError] = useState<string | null>(null);
  const [manualChecking, setManualChecking] = useState(false);

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const cooldownRef = useRef<NodeJS.Timeout | null>(null);

  const advanceIfVerified = async (token: string): Promise<boolean> => {
    const status = await api.checkEmailVerification({ token });
    if (status.verified) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      await api.setSetting({ key: "user_email", value: email.trim() });
      await api.setSetting({ key: "newsletter_opt_in", value: String(newsletterOptIn) });
      onNext(email.trim());
      return true;
    }
    return false;
  };

  // Poll for email verification once we have a token
  useEffect(() => {
    if (!verificationToken) return;

    pollRef.current = setInterval(async () => {
      try {
        await advanceIfVerified(verificationToken);
      } catch (err) {
        console.error("[email-step] poll error:", err);
        setPollError(err instanceof Error ? err.message : "Verification check failed");
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificationToken]);

  const handleManualContinue = async () => {
    if (!verificationToken) return;
    setManualChecking(true);
    setPollError(null);
    try {
      const advanced = await advanceIfVerified(verificationToken);
      if (!advanced) {
        setPollError("Your email hasn't been verified yet — please click the link in your inbox first.");
      }
    } catch (err) {
      setPollError(err instanceof Error ? err.message : "Verification check failed. Please try again.");
    } finally {
      setManualChecking(false);
    }
  };

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current!);
  }, [resendCooldown]);

  const sendVerification = async (targetEmail: string) => {
    setSending(true);
    setSendError(null);
    try {
      const result = await api.requestEmailVerification({
        email: targetEmail,
        newsletterOptIn,
      });
      setVerificationToken(result.token);
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send — please try again.");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!EMAIL_REGEX.test(email.trim())) {
      setValidationError("Please enter a valid email address.");
      return;
    }
    setValidationError(null);
    await sendVerification(email.trim());
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    await sendVerification(email.trim());
  };

  if (verificationToken) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="rounded-full bg-primary/10 p-3">
          <MailCheck className="size-10 text-primary" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to{" "}
          <span className="font-medium text-foreground">{email}</span>.
          Click the link to continue.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your spam folder if you don't see it.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            size="sm"
            onClick={handleManualContinue}
            disabled={manualChecking}
            className="w-full max-w-xs"
          >
            {manualChecking ? "Checking…" : "I've verified my email"}
          </Button>
          {pollError && (
            <p className="text-xs text-destructive text-center max-w-xs">{pollError}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleResend}
            disabled={resendCooldown > 0 || sending}
            className="gap-2"
          >
            <RefreshCw className="size-3" />
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend email"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => {
              setVerificationToken(null);
              setPollError(null);
              if (pollRef.current) clearInterval(pollRef.current);
            }}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-full bg-primary/10 p-3">
        <Mail className="size-10 text-primary" />
      </div>
      <h2 className="mt-4 text-2xl font-semibold">Verify your email</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        We'll send a quick verification link to confirm your address.
      </p>

      <div className="mt-6 w-full max-w-sm space-y-3">
        <div>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setValidationError(null);
              setSendError(null);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
            disabled={sending}
            autoFocus
          />
          {(validationError ?? sendError) && (
            <p className="mt-1 text-xs text-destructive">{validationError ?? sendError}</p>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-lg border px-4 py-3 text-left">
          <Checkbox
            id="newsletter-opt-in"
            checked={newsletterOptIn}
            onCheckedChange={(v) => setNewsletterOptIn(v === true)}
            className="mt-0.5"
          />
          <label htmlFor="newsletter-opt-in" className="cursor-pointer">
            <span className="text-sm font-medium">Send me product updates</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Occasional news about new features and releases. Unsubscribe any time.
            </p>
          </label>
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        size="lg"
        className="mt-4 w-full max-w-sm"
        disabled={sending || email.trim() === ""}
      >
        {sending ? "Sending…" : "Send verification link"}
      </Button>
    </div>
  );
}
