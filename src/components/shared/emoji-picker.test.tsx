import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmojiPicker } from "./emoji-picker";

describe("EmojiPicker", () => {
  it("shows default Flag icon for goal variant when no icon set", () => {
    const { container } = render(
      <EmojiPicker value={null} onChange={vi.fn()} variant="goal" />,
    );
    // Flag icon renders as SVG
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows default Briefcase icon for job variant when no icon set", () => {
    const { container } = render(
      <EmojiPicker value={null} onChange={vi.fn()} variant="job" />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the icon when a valid icon name is set", () => {
    const { container } = render(
      <EmojiPicker value="rocket" onChange={vi.fn()} variant="goal" />,
    );
    // "rocket" maps to the Rocket Lucide icon, rendered as SVG
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("opens popover on click and shows icon grid", () => {
    render(
      <EmojiPicker value={null} onChange={vi.fn()} variant="goal" />,
    );
    fireEvent.click(screen.getByTitle("Change icon"));
    // Icon grid buttons are identified by their title (icon name)
    expect(screen.getByTitle("target")).toBeInTheDocument();
    expect(screen.getByTitle("wrench")).toBeInTheDocument();
  });

  it("calls onChange when an icon is selected", () => {
    const onChange = vi.fn();
    render(
      <EmojiPicker value={null} onChange={onChange} variant="goal" />,
    );
    fireEvent.click(screen.getByTitle("Change icon"));
    fireEvent.click(screen.getByTitle("target"));
    expect(onChange).toHaveBeenCalledWith("target");
  });

  it("highlights the currently selected icon", () => {
    render(
      <EmojiPicker value="target" onChange={vi.fn()} variant="goal" />,
    );
    fireEvent.click(screen.getByTitle("Change icon"));
    // The selected icon button in the grid should have ring styling
    const gridButton = screen.getByTitle("target");
    expect(gridButton.className).toContain("ring-1");
  });

  it("shows AI regenerate button when onRegenerate is provided", () => {
    render(
      <EmojiPicker
        value={null}
        onChange={vi.fn()}
        variant="goal"
        onRegenerate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Change icon"));
    expect(screen.getByText("Let AI pick")).toBeInTheDocument();
  });

  it("calls onRegenerate when AI button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <EmojiPicker
        value={null}
        onChange={vi.fn()}
        variant="goal"
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByTitle("Change icon"));
    fireEvent.click(screen.getByText("Let AI pick"));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});
