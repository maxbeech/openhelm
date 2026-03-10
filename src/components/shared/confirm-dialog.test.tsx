import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("renders title and description when open", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Delete item"
        description="This cannot be undone."
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Delete item")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Confirm"
        description="Are you sure?"
        confirmLabel="Yes"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Yes"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows loading text when loading", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Confirm"
        description="Are you sure?"
        confirmLabel="Delete"
        onConfirm={() => {}}
        loading={true}
      />,
    );
    expect(screen.getByText("Working...")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Hidden"
        description="Should not appear"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });
});
