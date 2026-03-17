import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberStepper } from "./number-stepper";

describe("NumberStepper", () => {
  it("renders the current value", () => {
    render(<NumberStepper value={5} onChange={() => {}} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(5);
  });

  it("calls onChange with incremented value when + is clicked", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={3} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Increase"));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("calls onChange with decremented value when − is clicked", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={3} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Decrease"));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("does not decrement below min", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={1} onChange={onChange} min={1} />);
    const decBtn = screen.getByLabelText("Decrease");
    expect(decBtn).toBeDisabled();
    fireEvent.click(decBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not increment above max", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={31} onChange={onChange} max={31} />);
    const incBtn = screen.getByLabelText("Increase");
    expect(incBtn).toBeDisabled();
    fireEvent.click(incBtn);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange when input value changes within bounds", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={5} onChange={onChange} min={1} max={10} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "8" } });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it("ignores input values below min", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={5} onChange={onChange} min={1} max={10} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores input values above max", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={5} onChange={onChange} min={1} max={10} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses aria-label for button labels when provided", () => {
    render(<NumberStepper value={5} onChange={() => {}} aria-label="Interval amount" />);
    expect(screen.getByLabelText("Decrease Interval amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Increase Interval amount")).toBeInTheDocument();
  });
});
