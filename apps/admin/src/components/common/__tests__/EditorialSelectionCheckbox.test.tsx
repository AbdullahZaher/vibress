/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorialSelectionCheckbox } from "../EditorialSelectionCheckbox";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("EditorialSelectionCheckbox", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders unchecked state with accessible name", () => {
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={false}
          onChange={vi.fn()}
          label="Select post 1"
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).not.toBeNull();
    expect(input?.checked).toBe(false);
    expect(input?.getAttribute("aria-label")).toBe("Select post 1");
    expect(input?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders checked state with Check icon and aria-checked=true", () => {
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={true}
          onChange={vi.fn()}
          label="Select post 1"
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.checked).toBe(true);
    expect(input?.getAttribute("aria-checked")).toBe("true");
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains("lucide-check")).toBe(true);
  });

  it("renders indeterminate state with Minus icon and aria-checked=mixed", () => {
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={false}
          indeterminate={true}
          onChange={vi.fn()}
          label="Select all"
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.indeterminate).toBe(true);
    expect(input?.getAttribute("aria-checked")).toBe("mixed");
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon?.classList.contains("lucide-minus")).toBe(true);
  });

  it("renders visible label when showLabel is true", () => {
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={false}
          onChange={vi.fn()}
          label="Select all on this page"
          showLabel
        />
      );
    });

    expect(container.textContent).toContain("Select all on this page");
  });

  it("calls onChange when toggled", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={false}
          onChange={onChange}
          label="Toggle test"
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => {
      input?.click();
    });

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("respects disabled state", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <EditorialSelectionCheckbox
          checked={false}
          disabled={true}
          onChange={onChange}
          label="Disabled checkbox"
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.disabled).toBe(true);
    const label = container.querySelector("label");
    expect(label?.className).toContain("opacity-50");
  });
});

