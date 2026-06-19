"use client";

import { motion } from "framer-motion";
import { Panel } from "./Panel";
import { slideUp, transitions } from "@/lib/motion";

interface MotionPanelProps extends React.ComponentProps<typeof Panel> {
  delay?: number;
  hoverLift?: boolean;
}

export function MotionPanel({
  children,
  delay = 0,
  hoverLift = true,
  className = "",
  ...panelProps
}: MotionPanelProps) {
  return (
    <motion.div
      variants={slideUp}
      initial="hidden"
      animate="visible"
      transition={{ ...transitions.springSoft, delay }}
      whileHover={hoverLift ? { y: -2, transition: transitions.tweenFast } : undefined}
      className={className}
    >
      <Panel {...panelProps}>{children}</Panel>
    </motion.div>
  );
}
