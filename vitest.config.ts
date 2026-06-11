import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // The default "forks" pool can't reliably spawn child-process workers on
    // this Windows box — they time out before starting ("Timeout starting
    // forks runner"). Worker threads start cleanly here, so use them instead.
    pool: "threads",
    // This Windows box can't spin up a jsdom environment in every worker at
    // once — running all test files in parallel times the workers out and the
    // whole suite fails to start. Run files sequentially in a single worker so
    // the suite is reliable (slower, but it actually finishes).
    fileParallelism: false,
    // jsdom cold-start is slow here; the default 5s is flaky for the async
    // interaction tests (checkout/payment-success). 20s is comfortable.
    testTimeout: 20_000,
  },
});
