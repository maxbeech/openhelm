/**
 * Shared Framer Motion animation presets for a premium, Apple-like feel.
 *
 * Spring configs use stiffness/damping tuned for fluid, natural movement.
 * All durations are intentionally short — snappy but smooth.
 */
import { type Variants, type Transition } from "framer-motion";

// ─── Spring configs ────────────────────────────────────────────────────────────

/** Snappy spring — buttons, small interactive elements */
export const springSnap: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.8,
};

/** Smooth spring — panels, page transitions */
export const springSmooth: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

/** Gentle spring — large movements, sheets */
export const springGentle: Transition = {
  type: "spring",
  stiffness: 200,
  damping: 25,
  mass: 1,
};

// ─── Page / view transitions ───────────────────────────────────────────────────

/** Fade in with subtle upward slide — for content views */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -4, filter: "blur(2px)" },
};

export const pageTransition: Transition = {
  duration: 0.25,
  ease: [0.25, 0.1, 0.25, 1],
};

/**
 * Safari-style directional slide for back/forward navigation.
 * Pass `custom` as "forward" | "back" to both AnimatePresence and each motion.div.
 */
export const slidePageVariants: Variants = {
  initial: (direction: "forward" | "back") => ({
    opacity: 0,
    x: direction === "back" ? -36 : 36,
    filter: "blur(2px)",
  }),
  animate: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
  },
  exit: (direction: "forward" | "back") => ({
    opacity: 0,
    x: direction === "back" ? 36 : -36,
    filter: "blur(1px)",
  }),
};

export const slidePageTransition: Transition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1],
};

// ─── Panel slide (chat, right panels) ──────────────────────────────────────────

export const slidePanelVariants: Variants = {
  hidden: { x: "100%", opacity: 0.5 },
  visible: { x: 0, opacity: 1 },
  exit: { x: "100%", opacity: 0 },
};

export const slidePanelTransition: Transition = {
  ...springSmooth,
  opacity: { duration: 0.2 },
};

// ─── Collapse / expand (sidebar sections, accordions) ──────────────────────────

export const collapseVariants: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
      opacity: { duration: 0.15 },
    },
  },
  expanded: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] },
      opacity: { duration: 0.2, delay: 0.05 },
    },
  },
};

// ─── Staggered list entrance ───────────────────────────────────────────────────

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] },
  },
};

// ─── Fade in (simple) ──────────────────────────────────────────────────────────

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ─── Scale pop (badges, notifications, toasts) ────────────────────────────────

export const scalePop: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: springSnap,
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.15 },
  },
};

// ─── Hover lift (cards) ────────────────────────────────────────────────────────

export const hoverLift = {
  rest: { y: 0, boxShadow: "0 0 0 0 rgba(0,0,0,0)" },
  hover: {
    y: -2,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    transition: springSnap,
  },
};
