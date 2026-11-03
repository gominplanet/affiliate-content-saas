const config = {
  plugins: {
    tailwindcss: {},
    // After Tailwind: every violet in the compiled CSS becomes a --brand
    // variable, so a look can change MVP's colour (postcss/brand-vars.cjs).
    './postcss/brand-vars.cjs': {},
    autoprefixer: {},
  },
}

export default config
