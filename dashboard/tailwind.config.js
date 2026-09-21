/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        card: "var(--card)",
        cardHover: "var(--cardHover)",
        border: "var(--border)",
        input: "var(--input)",
        accent: "var(--accent)",
        accentSoft: "var(--accentSoft)",
        accentDim: "var(--accentDim)",
        accentBg: "var(--accentBg)",
        muted: "var(--muted)",
        fg: "var(--text)",
        ok: "var(--ok)",
        okBg: "var(--okBg)",
        warn: "var(--warn)",
        warnBg: "var(--warnBg)",
        bad: "var(--bad)",
        badBg: "var(--badBg)",
      },
    },
  },
  plugins: [],
};
