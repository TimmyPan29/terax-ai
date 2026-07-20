import { describe, expect, it } from "vitest";
import {
  accumulateScaleFactor,
  isTrackpadPinch,
  trackpadPinchScaleFactor,
} from "./pdfZoom";

describe("PDF trackpad pinch", () => {
  it("recognizes the pixel wheel shape emitted by a trackpad pinch", () => {
    expect(
      isTrackpadPinch({
        ctrlKey: true,
        deltaMode: 0,
        deltaX: 0,
        deltaY: -2,
        deltaZ: 0,
      }),
    ).toBe(true);
  });

  it("does not consume ordinary two-finger scrolling", () => {
    expect(
      isTrackpadPinch({
        ctrlKey: false,
        deltaMode: 0,
        deltaX: 0,
        deltaY: -2,
        deltaZ: 0,
      }),
    ).toBe(false);
  });

  it("maps upward pinch deltas to zoom in and downward deltas to zoom out", () => {
    expect(trackpadPinchScaleFactor(-2)).toBeGreaterThan(1);
    expect(trackpadPinchScaleFactor(2)).toBeLessThan(1);
  });

  it("keeps sub-percent scale changes instead of rounding them away", () => {
    const first = accumulateScaleFactor(1, 1.006, 1);
    const second = accumulateScaleFactor(1, 1.006, first.unusedFactor);

    expect(first.factor).toBe(1);
    expect(second.factor).toBeGreaterThan(1);
  });
});
