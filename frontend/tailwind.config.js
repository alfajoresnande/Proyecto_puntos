/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        ios: {
          bg: "#FDF6EE",
          card: "#ffffff",
          border: "rgba(60,60,67,0.12)",
          label: "#3c3c43",
          secondary: "rgba(60,60,67,0.6)",
          tertiary: "rgba(60,60,67,0.3)",
          blue: "#D4621A",
          green: "#34C759",
          red: "#FF3B30",
          orange: "#D4621A",
          gray5: "#FEF3E8",
          gray6: "#FDF6EE",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "SF Pro Text",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
