import React from 'react';
// Inline SVG icons — minimal stroke icons, no fills.
// Usage: <Icon name="bank" size={16}/>

const ICON_PATHS = {
  bank:        <><path d="M3 9 12 4l9 5"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 19h18"/></>,
  vault:       <><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="14" cy="12" r="3"/><path d="M14 9v-1M14 16v-1M11 12h-1M17 12h1"/></>,
  chart:       <><path d="M3 17l5-5 4 4 7-7"/><path d="M14 9h5v5"/></>,
  pillar:      <><path d="M3 21h18M5 21V9M19 21V9M9 21V9M15 21V9"/><path d="M3 9h18l-2-3H5z"/></>,
  lock:        <><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  cap:         <><path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c0 1 3 2 6 2s6-1 6-2v-5"/></>,

  cart:        <><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4h2l2 11h11l2-7H6"/></>,
  car:         <><path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7" cy="18" r="1"/><circle cx="17" cy="18" r="1"/></>,
  home:        <><path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/></>,
  plug:        <><path d="M9 3v4M15 3v4"/><path d="M7 7h10v3a5 5 0 0 1-10 0z"/><path d="M12 15v6"/></>,
  heart:       <><path d="M20 9c0 5-8 11-8 11S4 14 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1z"/></>,
  ticket:      <><path d="M3 9V7h18v2a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4z"/><path d="M14 7v14"/></>,
  plane:       <><path d="M3 12l18-7-7 18-2-7-7-2z"/></>,
  bag:         <><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
  gift:        <><rect x="3" y="9" width="18" height="11"/><path d="M3 13h18M12 9v11"/><path d="M8 9c-2-2 0-5 2-3l2 3-2 0c-2 0-2-1-2 0z"/><path d="M16 9c2-2 0-5-2-3l-2 3 2 0c2 0 2-1 2 0z"/></>,
  receipt:     <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  swap:        <><path d="M4 8h12l-3-3M20 16H8l3 3"/></>,
  coin:        <><circle cx="12" cy="12" r="8"/><path d="M9 10h5a2 2 0 0 1 0 4h-5"/><path d="M15 8v8"/></>,
  question:    <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="17" r=".5"/></>,
  arrowUp:     <><path d="M12 19V5M5 12l7-7 7 7"/></>,
  arrowDown:   <><path d="M12 5v14M5 12l7 7 7-7"/></>,
  user:        <><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 5-7 8-7s7 2 8 7"/></>,
  users:       <><circle cx="9" cy="9" r="3.5"/><circle cx="17" cy="11" r="2.5"/><path d="M2 21c1-4 4-6 7-6s6 2 7 6"/><path d="M16 21c0-3 2-5 4-5"/></>,
  briefcase:   <><rect x="3" y="7" width="18" height="13"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></>,
  pieChart:    <><path d="M12 3v9h9"/><circle cx="12" cy="12" r="9"/></>,
  clock:       <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  bolt:        <><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></>,
  sun:         <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon:        <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></>,
  eye:         <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff:      <><path d="M3 3l18 18"/><path d="M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.5 4.2"/><path d="M6.5 7.5A16 16 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  external:    <><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></>,
};

function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.6, style }) {
  const p = ICON_PATHS[name];
  if (!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {p}
    </svg>
  );
}

// Map account type → icon
const ACC_TYPE_ICON = {
  checking: 'bank', savings: 'bank',
  money_market: 'vault',
  brokerage: 'chart',
  pension_comprehensive: 'pillar', pension_supplementary: 'pillar',
  provident: 'lock',
  study_fund: 'cap',
};

// Map expense category → icon
const CAT_ICON = {
  food: 'cart', transport: 'car', housing: 'home', utilities: 'plug',
  health: 'heart', entertainment: 'ticket', travel: 'plane', shopping: 'bag',
  gifts: 'gift', taxes: 'receipt', savings_transfer: 'swap', fees: 'coin',
  other: 'coin', uncategorized: 'question',
};

export { Icon, ACC_TYPE_ICON, CAT_ICON };
