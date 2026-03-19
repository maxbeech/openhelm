import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UsageTypeStep } from "./usage-type-step";

vi.mock("@/lib/api", () => ({
  setSetting: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

import * as api from "@/lib/api";

const defaultProps = {
  userEmail: "",
  onBack: vi.fn(),
  onNext: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UsageTypeStep", () => {
  it("renders three usage type options", () => {
    render(<UsageTypeStep {...defaultProps} />);
    expect(screen.getByText("Personal use")).toBeInTheDocument();
    expect(screen.getByText("Educational use")).toBeInTheDocument();
    expect(screen.getByText("Business use")).toBeInTheDocument();
  });

  it("Continue button is disabled until an option is selected", () => {
    render(<UsageTypeStep {...defaultProps} />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue button after selecting an option", () => {
    render(<UsageTypeStep {...defaultProps} />);
    fireEvent.click(screen.getByText("Personal use"));
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("does not show employee count selector for personal use", () => {
    render(<UsageTypeStep {...defaultProps} />);
    fireEvent.click(screen.getByText("Personal use"));
    expect(screen.queryByText(/team members/i)).not.toBeInTheDocument();
  });

  it("shows employee count selector when Business is selected", () => {
    render(<UsageTypeStep {...defaultProps} />);
    fireEvent.click(screen.getByText("Business use"));
    expect(screen.getByText(/how many people/i)).toBeInTheDocument();
  });

  it("shows community tier message for 1-3 business members", () => {
    render(<UsageTypeStep {...defaultProps} />);
    fireEvent.click(screen.getByText("Business use"));
    // Default is 1-3
    expect(screen.getByText(/qualify for the free Community tier/i)).toBeInTheDocument();
  });

  it("saves usage_type setting on continue", async () => {
    const onNext = vi.fn();
    render(<UsageTypeStep {...defaultProps} onNext={onNext} />);
    fireEvent.click(screen.getByText("Personal use"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => {
      expect(api.setSetting).toHaveBeenCalledWith({ key: "usage_type", value: "personal" });
    });
    expect(onNext).toHaveBeenCalledWith("personal", "1-3");
  });

  it("saves employee_count for business type", async () => {
    const onNext = vi.fn();
    render(<UsageTypeStep {...defaultProps} onNext={onNext} />);
    fireEvent.click(screen.getByText("Business use"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => {
      expect(api.setSetting).toHaveBeenCalledWith({ key: "employee_count", value: "1-3" });
    });
  });

  it("shows mismatch warning when personal selected with corporate email", () => {
    render(<UsageTypeStep {...defaultProps} userEmail="john@acmecorp.com" />);
    fireEvent.click(screen.getByText("Personal use"));
    expect(screen.getByText(/this looks like a work email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change email/i })).toBeInTheDocument();
  });

  it("shows mismatch warning when education selected with corporate email", () => {
    render(<UsageTypeStep {...defaultProps} userEmail="john@acmecorp.com" />);
    fireEvent.click(screen.getByText("Educational use"));
    expect(screen.getByText(/this looks like a work email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change email/i })).toBeInTheDocument();
  });

  it("does not show warning for personal with free email domain", () => {
    render(<UsageTypeStep {...defaultProps} userEmail="user@gmail.com" />);
    fireEvent.click(screen.getByText("Personal use"));
    expect(screen.queryByRole("button", { name: /change email/i })).not.toBeInTheDocument();
  });

  it("does not show warning for business with corporate email", () => {
    render(<UsageTypeStep {...defaultProps} userEmail="john@acmecorp.com" />);
    fireEvent.click(screen.getByText("Business use"));
    expect(screen.queryByRole("button", { name: /change email/i })).not.toBeInTheDocument();
  });

  it("calls onBack when 'Change email' button is clicked", () => {
    const onBack = vi.fn();
    render(<UsageTypeStep {...defaultProps} userEmail="john@acmecorp.com" onBack={onBack} />);
    fireEvent.click(screen.getByText("Personal use"));
    fireEvent.click(screen.getByRole("button", { name: /change email/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("allows Continue despite mismatch warning", async () => {
    const onNext = vi.fn();
    render(<UsageTypeStep {...defaultProps} userEmail="john@acmecorp.com" onNext={onNext} />);
    fireEvent.click(screen.getByText("Personal use"));
    expect(screen.getByText(/this looks like a work email/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledWith("personal", "1-3");
    });
  });
});
