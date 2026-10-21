export type ImageSize = { width: number; height: number };
export const IMAGE_PADDING = 16;
export const MIN_IMAGE_ZOOM = 0.05;
export const MAX_IMAGE_ZOOM = 16;

export function fitImageScale(image: ImageSize, viewport: ImageSize): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.min(
    1,
    Math.max(1, viewport.width - IMAGE_PADDING * 2) / image.width,
    Math.max(1, viewport.height - IMAGE_PADDING * 2) / image.height,
  );
}

export function stepImageZoom(scale: number, direction: -1 | 1): number {
  return Math.min(
    MAX_IMAGE_ZOOM,
    Math.max(MIN_IMAGE_ZOOM, scale * 1.25 ** direction),
  );
}

export function imageLayout(
  image: ImageSize,
  viewport: ImageSize,
  scale: number,
) {
  const width = image.width * scale;
  const height = image.height * scale;
  const stageWidth = Math.max(viewport.width, width + IMAGE_PADDING * 2);
  const stageHeight = Math.max(viewport.height, height + IMAGE_PADDING * 2);
  return {
    width,
    height,
    stageWidth,
    stageHeight,
    left: (stageWidth - width) / 2,
    top: (stageHeight - height) / 2,
    viewport,
  };
}

export function imageZoomScroll(
  previous: ReturnType<typeof imageLayout>,
  next: ReturnType<typeof imageLayout>,
  scroll: { left: number; top: number },
) {
  const axis = (
    offset: number,
    oldView: number,
    oldOrigin: number,
    oldSize: number,
    newView: number,
    newOrigin: number,
    newSize: number,
    stage: number,
  ) =>
    Math.max(
      0,
      Math.min(
        stage - newView,
        ((offset + oldView / 2 - oldOrigin) / Math.max(1, oldSize)) * newSize +
          newOrigin -
          newView / 2,
      ),
    );
  return {
    left: axis(
      scroll.left,
      previous.viewport.width,
      previous.left,
      previous.width,
      next.viewport.width,
      next.left,
      next.width,
      next.stageWidth,
    ),
    top: axis(
      scroll.top,
      previous.viewport.height,
      previous.top,
      previous.height,
      next.viewport.height,
      next.top,
      next.height,
      next.stageHeight,
    ),
  };
}
