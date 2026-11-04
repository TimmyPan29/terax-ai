import { describe, expect, it } from "vitest";
import {
  clampPdfPreviewHeight,
  clampPdfPreviewWidth,
  PDF_PREVIEW_HEIGHT_DEFAULT,
  PDF_PREVIEW_HEIGHT_MAX,
  PDF_PREVIEW_HEIGHT_MIN,
  PDF_PREVIEW_WIDTH_DEFAULT,
  PDF_PREVIEW_WIDTH_MAX,
  PDF_PREVIEW_WIDTH_MIN,
} from "./store";

describe("PDF reference preview size preferences", () => {
  it("clamps width and height within valid bounds and falls back on non-finite values", () => {
    expect(clampPdfPreviewWidth(Number.NaN)).toBe(PDF_PREVIEW_WIDTH_DEFAULT);
    expect(clampPdfPreviewWidth(100)).toBe(PDF_PREVIEW_WIDTH_MIN);
    expect(clampPdfPreviewWidth(2400)).toBe(PDF_PREVIEW_WIDTH_MAX);
    expect(clampPdfPreviewWidth(720.4)).toBe(720);

    expect(clampPdfPreviewHeight(Number.POSITIVE_INFINITY)).toBe(
      PDF_PREVIEW_HEIGHT_DEFAULT,
    );
    expect(clampPdfPreviewHeight(80)).toBe(PDF_PREVIEW_HEIGHT_MIN);
    expect(clampPdfPreviewHeight(1600)).toBe(PDF_PREVIEW_HEIGHT_MAX);
    expect(clampPdfPreviewHeight(479.6)).toBe(480);
  });
});
