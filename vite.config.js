import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repo = "payoneer-payout";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? `/${repo}/` : "/",
}));
