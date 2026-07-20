export type PinchWheelLike = {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
};

const DOM_DELTA_PIXEL = 0;

export function isTrackpadPinch(event: PinchWheelLike): boolean {
  const scaleFactor = trackpadPinchScaleFactor(event.deltaY);
  return (
    event.ctrlKey &&
    event.deltaMode === DOM_DELTA_PIXEL &&
    event.deltaX === 0 &&
    event.deltaZ === 0 &&
    Math.abs(scaleFactor - 1) < 0.25
  );
}

export function trackpadPinchScaleFactor(deltaY: number): number {
  return Math.exp(-deltaY / 100);
}

export function accumulateScaleFactor(
  previousScale: number,
  factor: number,
  unusedFactor: number,
): { factor: number; unusedFactor: number } {
  if (factor === 1 || previousScale <= 0) {
    return { factor: 1, unusedFactor };
  }

  let remainder = unusedFactor;
  if ((remainder > 1 && factor < 1) || (remainder < 1 && factor > 1)) {
    remainder = 1;
  }

  const accumulated =
    Math.floor(previousScale * factor * remainder * 100) /
    (100 * previousScale);
  if (accumulated <= 0) {
    return { factor: 1, unusedFactor: 1 };
  }
  return { factor: accumulated, unusedFactor: factor / accumulated };
}
