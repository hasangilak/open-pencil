/** Tailwind's own stylesheet, loaded with the first Tailwind build in the app rather than with it. */
export async function loadTailwindStylesheet(): Promise<string> {
  const { default: css } = await import('tailwindcss/index.css?raw')
  return css
}
