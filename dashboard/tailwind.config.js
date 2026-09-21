/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0B",
        card: "#141419",
        cardHover: "#1A1A21",
        border: "#26262E",
        input: "#0E0E13",
        accent: "#8B5CF6",
        accentSoft: "#A78BFA",
        accentDim: "#3B2A5E",
        accentBg: "#1E1B2E",
        muted: "#9C9CAA",
        ok: "#22C55E",
        okBg: "#0E2A1E",
        warn: "#F59E0B",
        warnBg: "#241F10",
        bad: "#EF4444",
        badBg: "#2A1215",
      },
    },
  },
  plugins: [],
};
