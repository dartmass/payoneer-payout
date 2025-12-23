// vite.config.js（package.json と同じ階層）
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/payoneer-payout/",
});

