export function getOptionalEnv(key: string): string | undefined {
  // In Vite/Vercel, process.env is populated at build time (Vite) or runtime (Vercel)
  // Accessing specific keys ensures build tools don't tree-shake them if they analyze usage
  return process.env[key];
}

export function getEnv(key: string): string {
  const val = getOptionalEnv(key);
  if (!val || val.trim() === '') {
    throw new Error(`MISSING_KEY: ${key}`);
  }
  return val;
}
