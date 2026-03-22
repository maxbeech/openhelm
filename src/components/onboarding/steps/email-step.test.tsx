import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EmailStep } from "./email-step";

const requestEmailVerificationMock = vi.fn();
const checkEmailVerificationMock = vi.fn();
const setSettingMock = vi.fn();

vi.mock("@/lib/api", () => ({
  requestEmailVerification: (...args: any[]) => requestEmailVerificationMock(...args),
  checkEmailVerification: (...args: any[]) => checkEmailVerificationMock(...args),
  setSetting: (...args: any[]) => setSettingMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  requestEmailVerificationMock.mockResolvedValue({ sent: true, token: "test-token" });
  checkEmailVerificationMock.mockResolvedValue({ verified: false });
  setSettingMock.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EmailStep", () => {
  it("renders email input and newsletter checkbox", () => {
    render(<EmailStep onNext={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked(); // newsletter checked by default
  });

  it("shows generic email placeholder", () => {
    render(<EmailStep onNext={vi.fn()} />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  it("submit button disabled when email is empty", () => {
    render(<EmailStep onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /send verification/i })).toBeDisabled();
  });

  it("shows validation error for invalid email format", async () => {
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "notanemail" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    expect(requestEmailVerificationMock).not.toHaveBeenCalled();
  });

  it("calls requestEmailVerification with correct params", async () => {
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(() => {
      expect(requestEmailVerificationMock).toHaveBeenCalledWith({
        email: "user@example.com",
        newsletterOptIn: true,
      });
    }, { timeout: 3000 });
  });

  it("shows 'check your email' state after successful send", async () => {
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(
      () => { expect(screen.getByText(/check your email/i)).toBeInTheDocument(); },
      { timeout: 3000 },
    );
  });

  it("newsletter opt-in defaults to true and can be toggled", () => {
    render(<EmailStep onNext={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("shows 'I've verified' button after email is sent", async () => {
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(
      () => { expect(screen.getByRole("button", { name: /i've verified/i })).toBeInTheDocument(); },
      { timeout: 3000 },
    );
  });

  it("manual continue advances when verified", async () => {
    checkEmailVerificationMock.mockResolvedValue({ verified: true });
    const onNext = vi.fn();
    render(<EmailStep onNext={onNext} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(() => screen.getByRole("button", { name: /i've verified/i }), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });
    await waitFor(() => expect(onNext).toHaveBeenCalledWith("user@example.com"), { timeout: 3000 });
  });

  it("manual continue shows error when not yet verified", async () => {
    checkEmailVerificationMock.mockResolvedValue({ verified: false });
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(() => screen.getByRole("button", { name: /i've verified/i }), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });
    await waitFor(
      () => { expect(screen.getByText(/hasn't been verified yet/i)).toBeInTheDocument(); },
      { timeout: 3000 },
    );
  });

  it("manual continue shows error when check throws", async () => {
    checkEmailVerificationMock.mockRejectedValue(new Error("Network error"));
    render(<EmailStep onNext={vi.fn()} />);
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "user@example.com" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send verification/i }));
    });
    await waitFor(() => screen.getByRole("button", { name: /i've verified/i }), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i've verified/i }));
    });
    await waitFor(
      () => { expect(screen.getByText(/network error/i)).toBeInTheDocument(); },
      { timeout: 3000 },
    );
  });
});
