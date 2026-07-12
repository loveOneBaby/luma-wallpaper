// Named liquid-glass presets for each surface. Values are copied verbatim
// from the per-call-site props they replace — the dock, shelf, top capsules,
// status toast, recovery dialog, and drop layer each keep their distinct
// refraction. Spread a preset into <GlassSurface {...GLASS_CONTROL_DOCK} />.

const BASE = {
  width: null,
  height: null,
  borderRadius: null,
};

export const GLASS_LIBRARY_BUTTON = {
  ...BASE,
  borderWidth: 0.11,
  brightness: 72,
  opacity: 0.86,
  blur: 8,
  displace: 0.45,
  backgroundOpacity: 0.04,
  saturation: 1.35,
  distortionScale: -105,
  redOffset: -4,
  greenOffset: 8,
  blueOffset: 18,
  mixBlendMode: "screen",
};

export const GLASS_UPLOAD_BUTTON = {
  ...BASE,
  borderWidth: 0.1,
  brightness: 70,
  opacity: 0.86,
  blur: 8,
  displace: 0.35,
  backgroundOpacity: 0.04,
  saturation: 1.35,
  distortionScale: -115,
  redOffset: -3,
  greenOffset: 9,
  blueOffset: 19,
  mixBlendMode: "screen",
};

export const GLASS_STATUS_TOAST = {
  ...BASE,
  borderWidth: 0.1,
  brightness: 68,
  opacity: 0.84,
  blur: 9,
  // displace intentionally omitted: GlassSurface defaults to 0 (no extra blur),
  // matching the original call site.
  backgroundOpacity: 0.05,
  saturation: 1.35,
  distortionScale: -100,
  redOffset: -2,
  greenOffset: 8,
  blueOffset: 17,
  mixBlendMode: "screen",
};

export const GLASS_CONTROL_DOCK = {
  ...BASE,
  borderWidth: 0.09,
  brightness: 64,
  opacity: 0.9,
  blur: 11,
  displace: 0.65,
  backgroundOpacity: 0.035,
  saturation: 1.42,
  distortionScale: -155,
  redOffset: -6,
  greenOffset: 10,
  blueOffset: 22,
  mixBlendMode: "screen",
};

export const GLASS_CONFLICT_PANEL = {
  ...BASE,
  borderWidth: 0.085,
  brightness: 67,
  opacity: 0.88,
  blur: 10,
  displace: 0.5,
  backgroundOpacity: 0.05,
  saturation: 1.38,
  distortionScale: -135,
  redOffset: -4,
  greenOffset: 9,
  blueOffset: 20,
  mixBlendMode: "screen",
};

export const GLASS_DROP_MESSAGE = {
  ...BASE,
  borderWidth: 0.08,
  brightness: 70,
  opacity: 0.9,
  blur: 10,
  displace: 0.62,
  backgroundOpacity: 0.045,
  saturation: 1.4,
  distortionScale: -150,
  redOffset: -5,
  greenOffset: 10,
  blueOffset: 21,
  mixBlendMode: "screen",
};

export const GLASS_MEDIA_SHELF = {
  ...BASE,
  borderWidth: 0.075,
  brightness: 65,
  opacity: 0.88,
  blur: 10,
  displace: 0.55,
  backgroundOpacity: 0.045,
  saturation: 1.4,
  distortionScale: -145,
  redOffset: -5,
  greenOffset: 10,
  blueOffset: 21,
  mixBlendMode: "screen",
};
