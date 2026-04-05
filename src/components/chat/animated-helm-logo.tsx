import { useEffect, useId, useRef, useState } from "react";

interface AnimatedHelmLogoProps {
  animating: boolean;
  size?: number;
  className?: string;
}

function centroid(pts: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  return [cx / pts.length, cy / pts.length];
}

/**
 * Animate a sail with ALL edges fluttering like a flag in the wind.
 * Combines two displacement methods:
 *  1. Per-edge outward normal (ensures every edge waves, including mast-side)
 *  2. Distance-from-mast scaling (far edges wave more than mast edges)
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
  const [cx, cy] = centroid(points);
  let maxDist = 0;
  for (const [x] of points) {
    const d = Math.abs(x - mastX);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist === 0) maxDist = 1;

  const out: [number, number][] = [];
  for (let e = 0; e < points.length; e++) {
    const [x0, y0] = points[e];
    const [x1, y1] = points[(e + 1) % points.length];
    const edx = x1 - x0;
    const edy = y1 - y0;
    const len = Math.sqrt(edx * edx + edy * edy);
    if (len < 0.1) continue;

    // Outward normal for this edge
    let nx = -edy / len;
    let ny = edx / len;
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    if (nx * (midX - cx) + ny * (midY - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const edgePhase = phase + e * 0.6;

    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      let x = x0 + edx * t;
      let y = y0 + edy * t;

      // Distance from mast: 0 = on mast, 1 = farthest
      const distRatio = Math.abs(x - mastX) / maxDist;

      // Amplitude: minimum 0.25 for mast edges, up to 1.0 for far edges
      const distScale = 0.25 + 0.75 * distRatio;
      // Edge-length scaling (shorter edges flutter less)
      const edgeScale = Math.min(len / 180, 1.0);
      const amp = amplitude * distScale * edgeScale;

      // Endpoint anchoring: vertices stay fixed
      const anchor = Math.sin(t * Math.PI);

      // Smooth flag-like wave rolling along the edge
      const wave = Math.sin(t * Math.PI * 2 + time * freq + edgePhase);
      // Gentle secondary wave for organic motion
      const wave2 = Math.sin(t * Math.PI + time * freq * 0.5 + edgePhase + 1.3) * 0.3;

      const disp = amp * anchor * (wave + wave2);

      // Displace perpendicular to edge (outward from sail)
      x += nx * disp;
      y += ny * disp;
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
    right: billowSail(SAIL_RIGHT, 290, t, a * 22, +1, 3.2, 0),
    top:   billowSail(SAIL_TOP,   290, t, a * 16, +1, 3.8, 0.9),
    left:  billowSail(SAIL_LEFT,  272, t, a * 20, -1, 2.8, 1.6),
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
