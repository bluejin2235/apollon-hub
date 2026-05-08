import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        apollon: {
          50: "#f5f8ff",
          100: "#e9f0ff",
          200: "#d0dfff",
          300: "#a9c3ff",
          400: "#7c9dff",
          500: "#4f76ff",
          600: "#3558db",
          700: "#2d47af",
          800: "#283e8b",
          900: "#263673"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(79, 118, 255, 0.5), 0 0 35px rgba(53, 88, 219, 0.28)"
      }
    }
  },
  plugins: []
};

export default config;
