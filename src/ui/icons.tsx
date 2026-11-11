import type { ReactNode } from 'react';

/** Lucide paths (ISC licence), inlined. 20 px toolbars, 1.5 px stroke, currentColor. */
function Lucide({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PanelLeftIcon({ size }: { size?: number }) {
  return (
    <Lucide size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </Lucide>
  );
}

export function PanelLeftCloseIcon({ size }: { size?: number }) {
  return (
    <Lucide size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </Lucide>
  );
}

export function ArrowLeftIcon({ size }: { size?: number }) {
  return (
    <Lucide size={size}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Lucide>
  );
}

/** Caption glyphs: 10 px, 1 px crisp strokes like native Windows 11. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const MinimizeGlyph = () => (
  <Glyph>
    <path d="M0 5.5h10" />
  </Glyph>
);
export const MaximizeGlyph = () => (
  <Glyph>
    <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
  </Glyph>
);
export const RestoreGlyph = () => (
  <Glyph>
    <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
    <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
  </Glyph>
);
export const CloseGlyph = () => (
  <Glyph>
    <path d="M0 0l10 10M10 0L0 10" />
  </Glyph>
);
