import type { Transition, Variants } from "framer-motion";

export const transitions = {
  spring: { type: "spring", stiffness: 320, damping: 30 } satisfies Transition,
  springSoft: { type: "spring", stiffness: 200, damping: 25 } satisfies Transition,
  tweenFast: { duration: 0.2, ease: "easeOut" } satisfies Transition,
  tween: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } satisfies Transition,
  tweenSlow: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } satisfies Transition,
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.tween },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: transitions.springSoft },
};

export const slideRight: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: transitions.springSoft },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: transitions.springSoft },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

export const staggerContainerFast: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03, delayChildren: 0.02 },
  },
};

export const listItem: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: transitions.springSoft },
  exit: { opacity: 0, x: 8, transition: transitions.tweenFast },
};

export const pulseBadge: Variants = {
  initial: { scale: 1 },
  animate: {
    scale: [1, 1.05, 1],
    transition: { repeat: Infinity, duration: 2, ease: "easeInOut" },
  },
};

export const shimmer: Variants = {
  hidden: { x: "-100%" },
  visible: {
    x: "100%",
    transition: { repeat: Infinity, duration: 1.2, ease: "linear" as const },
  },
};
