// Removed reference to missing 'vite/client' types to fix compilation error.
// Added process.env type definition for API_KEY usage.
declare const process: {
  env: {
    API_KEY: string;
    [key: string]: string | undefined;
  }
};
