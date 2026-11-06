// Small stroke icon set (24px grid, 1.6 stroke) — no external icon dependency.
type P = { className?: string };
const S = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className ?? 'h-4 w-4'} aria-hidden="true">
    <path d={d} />
  </svg>
);
export const I = {
  home: (p: P) => <S {...p} d="M3 11l9-7 9 7M5 10v10h14V10" />,
  chart: (p: P) => <S {...p} d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  loan: (p: P) => <S {...p} d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  user: (p: P) => <S {...p} d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" />,
  users: (p: P) => <S {...p} d="M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 3.5a4 4 0 010 7.5M22 21a7 7 0 00-4-6.3" />,
  check: (p: P) => <S {...p} d="M20 6L9 17l-5-5" />,
  phone: (p: P) => <S {...p} d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />,
  book: (p: P) => <S {...p} d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3zM4 17a3 3 0 013-3h11" />,
  shield: (p: P) => <S {...p} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  register: (p: P) => <S {...p} d="M4 4h16v16H4zM4 9h16M9 9v11" />,
  spark: (p: P) => <S {...p} d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  settings: (p: P) => <S {...p} d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />,
  search: (p: P) => <S {...p} d="M11 18a7 7 0 100-14 7 7 0 000 14zm10 3l-5-5" />,
  plus: (p: P) => <S {...p} d="M12 5v14M5 12h14" />,
  sun: (p: P) => <S {...p} d="M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />,
  moon: (p: P) => <S {...p} d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  out: (p: P) => <S {...p} d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />,
  send: (p: P) => <S {...p} d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  whatsapp: (p: P) => <S {...p} d="M3 21l1.6-4.8A8.5 8.5 0 1112 20.5a8.6 8.6 0 01-4.2-1.1zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1a5 5 0 01-3-3l1-1-1-2z" />,
  mail: (p: P) => <S {...p} d="M3 5h18v14H3zM3 6l9 7 9-7" />,
  sms: (p: P) => <S {...p} d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  doc: (p: P) => <S {...p} d="M6 2h9l5 5v15H6zM14 2v6h6" />,
  download: (p: P) => <S {...p} d="M12 3v13m-5-5l5 5 5-5M4 21h16" />,
  arrow: (p: P) => <S {...p} d="M5 12h14m-6-6l6 6-6 6" />,
  back: (p: P) => <S {...p} d="M19 12H5m6 6l-6-6 6-6" />,
  gold: (p: P) => <S {...p} d="M4 18l3-8h10l3 8zM9 10l1.5-4h3L15 10" />,
  menu: (p: P) => <S {...p} d="M4 6h16M4 12h16M4 18h16" />,
  x: (p: P) => <S {...p} d="M6 6l12 12M18 6L6 18" />,
  api: (p: P) => <S {...p} d="M8 9l-4 3 4 3m8-6l4 3-4 3m-2-9l-4 14" />,
  vault: (p: P) => <S {...p} d="M4 4h16v16H4zM12 15a3 3 0 100-6 3 3 0 000 6zm0-3h4" />,
};
