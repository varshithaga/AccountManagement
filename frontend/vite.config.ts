/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_API_URL in .env points the app at the FastAPI backend (default: local uvicorn).
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = (env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

  return {
    plugins: [
      tailwindcss(),
      react({
        include: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
      }),
      svgr({
        svgrOptions: {
          icon: true,
          // This will transform your SVG to a React component
          exportType: "named",
          namedExport: "ReactComponent",
        },
      }),
    ],
    optimizeDeps: {
      exclude: ["vite"],
    },
    define: {
      // Global API URL variable
      __API_URL__: JSON.stringify(apiUrl),
    },
    test: {
      // npm test: unit tests of the helpers, and components rendered in a simulated browser.
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
