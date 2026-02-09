import { useEffect, useRef, useState } from 'react';

// pdfjs-dist is loaded on-demand when a user actually opens a PDF
let pdfjsLib: typeof import('pdfjs-dist') | null = null;
let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = import('pdfjs-dist').then((mod) => {
      pdfjsLib = mod;
      mod.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
      return mod;
    });
  }
  return pdfjsReady;
}

interface PdfRendererProps {
  data: string; // base64 encoded PDF
  scrollRef?: (el: HTMLDivElement | null) => void;
}

export function PdfRenderer({ data, scrollRef }: PdfRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderIdRef = useRef(0);

  // Combine refs
  const setRef = (el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    scrollRef?.(el);
  };

  useEffect(() => {
    if (!data) return;
    const renderId = ++renderIdRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await loadPdfjs();
        if (!pdfjsLib || renderId !== renderIdRef.current) return;

        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (renderId !== renderIdRef.current) return;

        const container = containerRef.current;
        if (!container) return;
        // Clear previous canvases safely (no HTML parsing involved)
        while (container.firstChild) container.removeChild(container.firstChild);

        const containerWidth = container.clientWidth - 24; // padding

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (renderId !== renderIdRef.current) return;

          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(containerWidth / viewport.width, 2);
          const scaledViewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 8px';
          canvas.style.maxWidth = '100%';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise;
          if (renderId !== renderIdRef.current) return;
          container.appendChild(canvas);
        }

        setLoading(false);
      } catch (err) {
        if (renderId !== renderIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to render PDF');
        setLoading(false);
      }
    })();

    return () => { renderIdRef.current++; };
  }, [data]);

  return (
    <div
      ref={setRef}
      className="pdf-renderer"
    >
      {loading && (
        <div style={{ padding: '20px', textAlign: 'center', color: '#565f89', fontSize: 13 }}>
          Loading PDF...
        </div>
      )}
      {error && (
        <div style={{ padding: '12px', color: '#f7768e', fontSize: 12 }}>
          PDF Error: {error}
        </div>
      )}
    </div>
  );
}
