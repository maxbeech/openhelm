import { useEffect, useId, useRef, useState } from "react";

interface AnimatedHelmLogoProps {
  animating: boolean;
  size?: number;
  className?: string;
}

/**
 * Animate a sail polygon with a 2D traveling wave through its body,
 * like a canvas flag flapping in the wind. Points near the mast stay
 * anchored; the wave amplitude increases with distance from the mast.
 * The wave phase varies across both x and y, creating undulation through
 * the entire sail surface.
 */
function billowSail(
  points: [number, number][],
  mastX: number,
  time: number,
  amplitude: number,
  direction: number,
  freq: number,
  phase: number,
  samples = 22,
): string {
  let maxDist = 0, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    const d = Math.abs(x - mastX);
    if (d > maxDist) maxDist = d;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const yRange = maxY - minY || 1;
  if (maxDist === 0) maxDist = 1;

  const out: [number, number][] = [];
  for (let e = 0; e < points.length; e++) {
    const [x0, y0] = points[e];
    const [x1, y1] = points[(e + 1) % points.length];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      let x = x0 + (x1 - x0) * t;
      let y = y0 + (y1 - y0) * t;

      // Distance from mast: 0 = anchored at mast, 1 = farthest point
      const distRatio = Math.abs(x - mastX) / maxDist;
      // Vertical position normalized: 0 = top, 1 = bottom
      const yNorm = (y - minY) / yRange;

      // Amplitude grows with distance from mast (anchored near mast)
      const amp = amplitude * distRatio * Math.sqrt(distRatio);

      // Primary traveling wave: phase varies with both position dimensions,
      // creating a 2D undulation like a flag
      const wave1 = Math.sin(
        yNorm * Math.PI * 2.5 + distRatio * Math.PI * 1.5 + time * freq + phase,
      );
      // Secondary slower wave for organic, non-repeating motion
      const wave2 = Math.sin(
        yNorm * Math.PI * 1.2 + distRatio * Math.PI * 0.8 + time * freq * 0.6 + phase + 1.5,
      ) * 0.35;

      // Horizontal displacement: outward from mast
      const dx = direction * amp * (wave1 + wave2);
      // Subtle vertical ripple
      const dy = amp * 0.12 * Math.sin(
        yNorm * Math.PI * 3 + time * freq * 0.7 + phase + 0.8,
      );

      x += dx;
      y += dy;
      out.push([x, y]);
    }
  }

  if (out.length === 0) return "";
  let d = `M${out[0][0].toFixed(1)} ${out[0][1].toFixed(1)}`;
  for (let i = 1; i < out.length; i++) {
    d += ` L${out[i][0].toFixed(1)} ${out[i][1].toFixed(1)}`;
  }
  return d + "Z";
}

const SAIL_RIGHT: [number, number][] = [
  [502.5, 109.5], [443.5, 264.5], [290.5, 338], [290.5, 233],
];
const SAIL_TOP: [number, number][] = [
  [396, 73], [376.5, 166], [290.5, 213.5], [290.5, 130.5],
];
const SAIL_LEFT: [number, number][] = [
  [272, 64], [272, 338], [68, 264.5], [97.16, 128.44], [143.56, 86.52],
];

const REST = {
  right: "M443.5 264.5L290.5 338V233L502.5 109.5L443.5 264.5Z",
  top: "M376.5 166L290.5 213.5V130.5L396 73L376.5 166Z",
  left: "M272 64V338L68 264.5C97.1647 128.441 143.563 86.522 272 64Z",
};

function computePaths(t: number, a: number) {
  return {
    right: billowSail(SAIL_RIGHT, 290, t, a * 45, +1, 5.0, 0),
    top:   billowSail(SAIL_TOP,   290, t, a * 30, +1, 5.8, 0.9),
    left:  billowSail(SAIL_LEFT,  272, t, a * 42, -1, 4.5, 1.6),
  };
}

export function AnimatedHelmLogo({ animating, size = 28, className = "" }: AnimatedHelmLogoProps) {
  const uid = useId().replace(/:/g, "");
  const [visible, setVisible] = useState(!animating);
  const [paths, setPaths] = useState(REST);

  const animatingRef = useRef(animating);
  const ampRef = useRef(animating ? 1 : 0);
  const timeRef = useRef(0);
  const prevTsRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => { animatingRef.current = animating; }, [animating]);

  useEffect(() => {
    if (!visible) {
      const f = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(f);
    }
  }, []);

  useEffect(() => {
    function tick(ts: number) {
      const dt = prevTsRef.current ? (ts - prevTsRef.current) / 1000 : 0.016;
      prevTsRef.current = ts;
      timeRef.current += dt;

      const target = animatingRef.current ? 1 : 0;
      const amp = ampRef.current;
      if (target > amp) ampRef.current = Math.min(1, amp + dt * 2.5);
      else if (target < amp) ampRef.current = Math.max(0, amp - dt * 0.5);

      const a = ampRef.current;
      if (a < 0.003 && !animatingRef.current) {
        setPaths(REST);
        rafRef.current = 0;
        return;
      }

      setPaths(computePaths(timeRef.current, a));
      rafRef.current = requestAnimationFrame(tick);
    }

    cancelAnimationFrame(rafRef.current);
    prevTsRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [animating]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 570 570"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.5)",
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
        flexShrink: 0,
      }}
    >
      <defs>
        <linearGradient id={`${uid}_g0`} x1="264" y1="231" x2="264" y2="506.702" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B8EAE" /><stop offset="1" stopColor="#96AEC5" />
        </linearGradient>
        <linearGradient id={`${uid}_g1`} x1="264" y1="231" x2="264" y2="506.702" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B8EAE" /><stop offset="1" stopColor="#96AEC5" />
        </linearGradient>
        <linearGradient id={`${uid}_g2`} x1="285.25" y1="64" x2="285.25" y2="338" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E53D00" /><stop offset="1" stopColor="#FF6933" />
        </linearGradient>
        <linearGradient id={`${uid}_g3`} x1="285.25" y1="64" x2="285.25" y2="338" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E53D00" /><stop offset="1" stopColor="#FF6933" />
        </linearGradient>
        <linearGradient id={`${uid}_g4`} x1="285.25" y1="64" x2="285.25" y2="338" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E53D00" /><stop offset="1" stopColor="#FF6933" />
        </linearGradient>
      </defs>

      <path d="M549.5 231L123 439.5C234.5 549.5 397.5 518 465.5 392L549.5 231Z" fill={`url(#${uid}_g0)`} fillOpacity="0.9" />
      <path d="M114.5 424L259 353L21 268L114.5 424Z" fill={`url(#${uid}_g1)`} fillOpacity="0.9" />
      <path d={paths.right} fill={`url(#${uid}_g2)`} fillOpacity="0.9" />
      <path d={paths.top} fill={`url(#${uid}_g3)`} fillOpacity="0.9" />
      <path d={paths.left} fill={`url(#${uid}_g4)`} fillOpacity="0.9" />
    </svg>
  );
}
