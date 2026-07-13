import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./GlassSurface.css";

function supportsSvgBackdropFilter(filterId) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isFirefox = /Firefox/.test(navigator.userAgent);
  if (isSafari || isFirefox) return false;

  const probe = document.createElement("div");
  probe.style.backdropFilter = `url(#${filterId})`;
  return probe.style.backdropFilter !== "";
}

function getGlassPreferences() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { simplified: false, reducedTransparency: false };
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const reducedTransparency =
    window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches ?? false;
  const lowCpu =
    Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4;
  const lowMemory = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;
  const saveData = navigator.connection?.saveData === true;

  return {
    simplified: reducedMotion || reducedTransparency || lowCpu || lowMemory || saveData,
    reducedTransparency,
  };
}

export function GlassSurface({
  as: Component = "div",
  children,
  width = 200,
  height = 80,
  borderRadius = 20,
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  displace = 0,
  backgroundOpacity = 0,
  saturation = 1,
  distortionScale = -180,
  redOffset = 0,
  greenOffset = 10,
  blueOffset = 20,
  xChannel = "R",
  yChannel = "G",
  mixBlendMode = "difference",
  className = "",
  style = {},
  ...rest
}) {
  const uniqueId = useId().replace(/:/g, "-");
  const filterId = `glass-filter-${uniqueId}`;
  const redGradId = `red-grad-${uniqueId}`;
  const blueGradId = `blue-grad-${uniqueId}`;

  const [svgSupported, setSvgSupported] = useState(false);
  const [glassPreferences, setGlassPreferences] = useState(getGlassPreferences);
  const containerRef = useRef(null);
  const feImageRef = useRef(null);
  const redChannelRef = useRef(null);
  const greenChannelRef = useRef(null);
  const blueChannelRef = useRef(null);
  const gaussianBlurRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQueries = [
      window.matchMedia?.("(prefers-reduced-motion: reduce)"),
      window.matchMedia?.("(prefers-reduced-transparency: reduce)"),
    ].filter(Boolean);
    const connection = navigator.connection;
    const updatePreferences = () => setGlassPreferences(getGlassPreferences());

    mediaQueries.forEach((query) => query.addEventListener?.("change", updatePreferences));
    connection?.addEventListener?.("change", updatePreferences);

    return () => {
      mediaQueries.forEach((query) => query.removeEventListener?.("change", updatePreferences));
      connection?.removeEventListener?.("change", updatePreferences);
    };
  }, []);

  const generateDisplacementMap = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const actualWidth = Math.max(rect?.width || 400, 1);
    const actualHeight = Math.max(rect?.height || 200, 1);
    const actualRadius =
      borderRadius == null
        ? Number.parseFloat(getComputedStyle(containerRef.current).borderTopLeftRadius) || 0
        : borderRadius;
    const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

    const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect width="${actualWidth}" height="${actualHeight}" fill="black"/>
        <rect width="${actualWidth}" height="${actualHeight}" rx="${actualRadius}" fill="url(#${redGradId})"/>
        <rect width="${actualWidth}" height="${actualHeight}" rx="${actualRadius}" fill="url(#${blueGradId})" style="mix-blend-mode:${mixBlendMode}"/>
        <rect x="${edgeSize}" y="${edgeSize}" width="${Math.max(actualWidth - edgeSize * 2, 1)}" height="${Math.max(actualHeight - edgeSize * 2, 1)}" rx="${actualRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)"/>
      </svg>
    `;

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
  }, [blueGradId, blur, borderRadius, borderWidth, brightness, mixBlendMode, opacity, redGradId]);

  const updateDisplacementMap = useCallback(() => {
    feImageRef.current?.setAttribute("href", generateDisplacementMap());
  }, [generateDisplacementMap]);

  useEffect(() => {
    if (glassPreferences.simplified || !svgSupported) return;

    updateDisplacementMap();
    [
      { ref: redChannelRef, offset: redOffset },
      { ref: greenChannelRef, offset: greenOffset },
      { ref: blueChannelRef, offset: blueOffset },
    ].forEach(({ ref, offset }) => {
      ref.current?.setAttribute("scale", String(distortionScale + offset));
      ref.current?.setAttribute("xChannelSelector", xChannel);
      ref.current?.setAttribute("yChannelSelector", yChannel);
    });
    gaussianBlurRef.current?.setAttribute("stdDeviation", String(displace));
  }, [
    blueOffset,
    displace,
    distortionScale,
    greenOffset,
    glassPreferences.simplified,
    redOffset,
    svgSupported,
    updateDisplacementMap,
    xChannel,
    yChannel,
  ]);

  useEffect(() => {
    if (
      glassPreferences.simplified ||
      !svgSupported ||
      !containerRef.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return undefined;
    }

    let frameId = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateDisplacementMap);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [glassPreferences.simplified, svgSupported, updateDisplacementMap]);

  useEffect(() => {
    setSvgSupported(!glassPreferences.simplified && supportsSvgBackdropFilter(filterId));
  }, [filterId, glassPreferences.simplified]);

  const containerStyle = {
    ...style,
    ...(width == null ? {} : { width: typeof width === "number" ? `${width}px` : width }),
    ...(height == null ? {} : { height: typeof height === "number" ? `${height}px` : height }),
    ...(borderRadius == null ? {} : { borderRadius: `${borderRadius}px` }),
    "--glass-frost": backgroundOpacity,
    "--glass-saturation": saturation,
    "--filter-id": `url(#${filterId})`,
  };
  const ContentElement = Component === "button" || Component === "a" ? "span" : "div";
  const glassModeClass = svgSupported ? "glass-surface--svg" : "glass-surface--fallback";
  const preferenceClasses = [
    glassPreferences.simplified ? "glass-surface--simplified" : "",
    glassPreferences.reducedTransparency ? "glass-surface--reduced-transparency" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component
      ref={containerRef}
      className={`glass-surface ${glassModeClass} ${preferenceClasses} ${className}`.trim()}
      style={containerStyle}
      {...rest}
    >
      {svgSupported && !glassPreferences.simplified ? (
        <svg
          className="glass-surface__filter"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <filter
              id={filterId}
              colorInterpolationFilters="sRGB"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
            >
              <feImage
                ref={feImageRef}
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                result="map"
              />
              <feDisplacementMap
                ref={redChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispRed"
              />
              <feColorMatrix
                in="dispRed"
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="red"
              />
              <feDisplacementMap
                ref={greenChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispGreen"
              />
              <feColorMatrix
                in="dispGreen"
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="green"
              />
              <feDisplacementMap
                ref={blueChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispBlue"
              />
              <feColorMatrix
                in="dispBlue"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="blue"
              />
              <feBlend in="red" in2="green" mode="screen" result="rg" />
              <feBlend in="rg" in2="blue" mode="screen" result="output" />
              <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0.7" />
            </filter>
          </defs>
        </svg>
      ) : null}

      <ContentElement className="glass-surface__content">{children}</ContentElement>
    </Component>
  );
}

export default GlassSurface;
