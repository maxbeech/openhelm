import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WelcomeStep } from "./welcome-step";

vi.mock("@/lib/api", () => ({
  setSetting: vi.fn().mockResolvedValue({}),
}));

// @/lib/sentry is globally mocked in test-setup.ts

import * as api from "@/lib/api";
import { setAnalyticsEnabled } from "@/lib/sentry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WelcomeStep", () => {
  it("renders with analytics checkbox checked by default", () => {
    render(<WelcomeStep onNext={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /help improve openorchestra/i });
    expect(checkbox).toBeChecked();
  });

  it("calls api.setSetting with 'false' when unchecked", async () => {
    render(<WelcomeStep onNext={() => {}} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(api.setSetting).toHaveBeenCalledWith({
      key: "analytics_enabled",
      value: "false",
    });
  });

  it("calls api.setSetting with 'true' when re-checked", async () => {
    render(<WelcomeStep onNext={() => {}} />);
    const checkbox = screen.getByRole("checkbox");
    // Uncheck then re-check
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(api.setSetting).toHaveBeenLastCalledWith({
      key: "analytics_enabled",
      value: "true",
    });
  });

  it("calls setAnalyticsEnabled with correct boolean on change", () => {
    render(<WelcomeStep onNext={() => {}} />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox); // uncheck
    expect(setAnalyticsEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(checkbox); // re-check
    expect(setAnalyticsEnabled).toHaveBeenCalledWith(true);
  });

  it("calls onNext when button clicked", () => {
    const onNext = vi.fn();
    render(<WelcomeStep onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: /let's get started/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
