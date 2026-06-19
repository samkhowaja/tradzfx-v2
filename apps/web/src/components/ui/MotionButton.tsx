"use client";

import { motion } from "framer-motion";
import { Button } from "./Button";
import { transitions } from "@/lib/motion";

interface MotionButtonProps extends React.ComponentProps<typeof Button> {}

export function MotionButton({ children, ...props }: MotionButtonProps) {
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.01 }}
      transition={transitions.tweenFast}
      className="inline-flex"
    >
      <Button {...props}>{children}</Button>
    </motion.div>
  );
}
