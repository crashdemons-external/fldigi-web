// Frequencies are audio Hz. The modem worker supplies offsets from the
// original WFdisp::makeMarker / update_waterfall rules in waterfall.cxx.
export const SCALE_HEIGHT = 23;
export const MARKER_HEIGHT = 6; // fldigi-config.h: WFMARKER
export const WATERFALL_TOP = SCALE_HEIGHT + MARKER_HEIGHT;

export function clampTuningFrequency(frequency, bandwidth, low = 0, high = 4000) {
  const minimum = low + bandwidth / 2, maximum = high - bandwidth / 2;
  return minimum <= maximum ? Math.max(minimum, Math.min(maximum, frequency)) : (low + high) / 2;
}

export function pointerFrequency(x, width, start, range, bandwidth, low, high) {
  return clampTuningFrequency(start + Math.max(0, Math.min(width, x)) / width * range, bandwidth, low, high);
}

export function positionMarkers(geometry, frequency, start, range, width) {
  const x = offset => (frequency + offset - start) / range * width;
  return {
    center: x(0),
    bands: geometry.bands.map(([low, high]) => [x(low), x(high)]),
    tracks: geometry.tracks.map(x),
    hover: geometry.hover.map(x),
    markerEdges: geometry.markerEdges.map(x),
  };
}

// Snap once around a shared pixel center. Rounding absolute edges separately
// can give symmetric filters different widths/distances at fractional x values.
// These positions denote pixel centers, including the inclusive band endpoints.
export function snapMarkerPositions(positions) {
  const center = Math.floor(positions.center) + 0.5;
  const snap = x => {
    const offset = x - positions.center;
    return center + Math.sign(offset) * Math.round(Math.abs(offset));
  };
  return {
    center,
    bands: positions.bands.map(([low, high]) => [snap(low), snap(high)]),
    tracks: positions.tracks.map(snap),
    hover: positions.hover.map(snap),
    markerEdges: positions.markerEdges.map(snap),
  };
}
