import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBanner } from "./error-banner";

describe("ErrorBanner", () => {
  it("renders the error message", () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows Retry button when onRetry is provided", () => {
    render(<ErrorBanner message="Error" onRetry={() => {}} />);
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("does not show Retry button when onRetry is not provided", () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it("shows dismiss button when onDismiss is provided", () => {
    const { container } = render(
      <ErrorBanner message="Error" onDismiss={() => {}} />,
    );
    // The dismiss button contains the X icon (an SVG)
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(1);
  });

  it("does not show dismiss button when onDismiss is not provided", () => {
    const { container } = render(<ErrorBanner message="Error" />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("calls onRetry when Retry is clicked", () => {
    const handleRetry = vi.fn();
    render(<ErrorBanner message="Error" onRetry={handleRetry} />);
    fireEvent.click(screen.getByText("Retry"));
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const handleDismiss = vi.fn();
    const { container } = render(
      <ErrorBanner message="Error" onDismiss={handleDismiss} />,
    );
    const dismissButton = container.querySelector("button");
    fireEvent.click(dismissButton!);
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders both Retry and dismiss when both handlers are provided", () => {
    const { container } = render(
      <ErrorBanner
        message="Error"
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });
});
