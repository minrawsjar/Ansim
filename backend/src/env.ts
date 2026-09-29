// Imported first by server.ts so every other module sees the variables at load time.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(new URL(`../${file}`, import.meta.url));
  } catch {
    // file is optional
  }
}
