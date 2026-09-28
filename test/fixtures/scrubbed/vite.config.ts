export default {
  define: { "import.meta.vitest": "undefined" },
  build: { lib: { entry: "src/cart.ts", formats: ["es"], fileName: "cart" } },
};
