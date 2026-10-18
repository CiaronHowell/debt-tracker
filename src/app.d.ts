declare global {
  namespace App {}

  /** `package.json` version, injected by Vite at build time. */
  const __APP_VERSION__: string;
  /** Short git commit of the build, injected by Vite at build time. */
  const __APP_COMMIT__: string;
}

export {};
