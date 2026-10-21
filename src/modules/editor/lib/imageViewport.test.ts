import { describe, expect, it } from "vitest";
import {
  fitImageScale,
  imageLayout,
  imageZoomScroll,
  MIN_IMAGE_ZOOM,
  MAX_IMAGE_ZOOM,
  stepImageZoom,
} from "@/modules/editor/lib/imageViewport";

const image = { width: 1200, height: 800 };
const viewport = { width: 632, height: 432 };

describe("image viewport", () => {
  it("fits either landscape or portrait images inside the padded viewport", () => {
    expect(fitImageScale(image, viewport)).toBe(0.5);
    expect(fitImageScale({ width: 800, height: 1200 }, viewport)).toBeCloseTo(
      1 / 3,
    );
    expect(fitImageScale({ width: 20, height: 10 }, viewport)).toBe(1);
    expect(fitImageScale(image, { width: 0, height: 0 })).toBeGreaterThan(0);
  });

  it("enlarges the actual scrollable bounds on both axes without negative image origins", () => {
    const layout = imageLayout(image, viewport, 2);
    expect(layout.width).toBe(2400);
    expect(layout.height).toBe(1600);
    expect(layout.stageWidth).toBe(2432);
    expect(layout.stageHeight).toBe(1632);
    expect(layout.left).toBe(16);
    expect(layout.top).toBe(16);
  });

  it("centers images smaller than the viewport", () => {
    const layout = imageLayout(image, viewport, 0.1);
    expect(layout.left).toBe((632 - 120) / 2);
    expect(layout.top).toBe((432 - 80) / 2);
  });

  it("keeps the same image point at the viewport center while zooming", () => {
    const old = imageLayout(image, viewport, 1);
    const next = imageLayout(image, viewport, 2);
    const scroll = { left: 100, top: 50 };
    const result = imageZoomScroll(old, next, scroll);
    expect(
      (result.left + viewport.width / 2 - next.left) / next.width,
    ).toBeCloseTo((scroll.left + viewport.width / 2 - old.left) / old.width);
    expect(
      (result.top + viewport.height / 2 - next.top) / next.height,
    ).toBeCloseTo((scroll.top + viewport.height / 2 - old.top) / old.height);
  });

  it("returns to the full image when Fit removes overflow", () => {
    const old = imageLayout(image, viewport, 2);
    const next = imageLayout(image, viewport, fitImageScale(image, viewport));
    expect(imageZoomScroll(old, next, { left: 1700, top: 1100 })).toEqual({
      left: 0,
      top: 0,
    });
  });

  it("limits zoom and allows zooming up from a fit smaller than the manual minimum", () => {
    expect(stepImageZoom(MAX_IMAGE_ZOOM, 1)).toBe(MAX_IMAGE_ZOOM);
    expect(stepImageZoom(MIN_IMAGE_ZOOM, -1)).toBe(MIN_IMAGE_ZOOM);
    expect(stepImageZoom(0.001, 1)).toBe(MIN_IMAGE_ZOOM);
    expect(stepImageZoom(stepImageZoom(1, 1), -1)).toBeCloseTo(1);
  });
});
