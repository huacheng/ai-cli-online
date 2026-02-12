/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Workaround: @types/react-dom v18.3.x package format not resolved by npm
declare module 'react-dom/client';

// CDN-loaded mermaid ESM module
declare module 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs' {
  const mermaid: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, definition: string) => Promise<{ svg: string }>;
  };
  export default mermaid;
}
