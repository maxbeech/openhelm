import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";

export function NewsletterSection() {
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);

  useEffect(() => {
    api
      .getSetting("newsletter_email")
      .then((s) => { if (s?.value) setNewsletterEmail(s.value); })
      .catch(() => {});
  }, []);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const saveEmail = async () => {
    if (!isValidEmail(emailInput.trim())) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailSaving(true);
    setEmailError(null);
    try {
      await api.setSetting({ key: "newsletter_email", value: emailInput.trim() });
      setNewsletterEmail(emailInput.trim());
      setEmailEditing(false);
    } catch {
      setEmailError("Failed to save — please try again.");
    } finally {
      setEmailSaving(false);
    }
  };

  const removeEmail = async () => {
    try {
      await api.deleteSetting("newsletter_email");
      setNewsletterEmail("");
      setEmailInput("");
      setEmailEditing(false);
    } catch {
      // Silently ignore
    }
  };

  const startEditing = () => {
    setEmailInput(newsletterEmail);
    setEmailError(null);
    setEmailEditing(true);
  };

  return (
    <div>
      <Label className="text-sm text-foreground">Newsletter</Label>
      <p className="mb-2 text-xs text-muted-foreground">
        Receive occasional updates on new features and releases.
      </p>
      {newsletterEmail && !emailEditing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm">{newsletterEmail}</span>
          <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs" onClick={startEditing}>
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-0.5 text-xs text-destructive hover:text-destructive"
            onClick={removeEmail}
          >
            Remove
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(e) => { setEmailInput(e.target.value); setEmailError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEmail();
                if (e.key === "Escape" && emailEditing) setEmailEditing(false);
              }}
              disabled={emailSaving}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              className="h-8"
              onClick={() => void saveEmail()}
              disabled={emailSaving || emailInput.trim() === ""}
            >
              {emailSaving ? "Saving…" : "Subscribe"}
            </Button>
            {emailEditing && (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEmailEditing(false)} disabled={emailSaving}>
                Cancel
              </Button>
            )}
          </div>
          {emailError && <p className="text-xs text-destructive">{emailError}</p>}
        </div>
      )}
    </div>
  );
}
