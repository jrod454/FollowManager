import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const configuredBase =
    process.env.VITE_FOLLOW_MANAGER_BASE_PATH || "/FollowManager/";
  const base = mode === "production" ? configuredBase : "/";

  return {
    base,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/setupTests.ts"
    }
  };
});
