import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["itemflow/public/js/**/__tests__/**/*.test.js"],
		environment: "node",
	},
});
