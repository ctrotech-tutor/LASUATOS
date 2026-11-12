import { ImageResponse } from 'next/og';

// The card shown when a LASUATOS link is shared on WhatsApp, Telegram, X or LinkedIn.
export const alt = 'LASUATOS — scan the QR code to mark lecture attendance at Lagos State University';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BLUE = '#153B5B';
const OCHRE = '#D8B15C';
const PAPER = '#F7F8F4';

function Mark({ px }: Readonly<{ px: number }>) {
  return (
    <svg width={px} height={px} viewBox="0 0 48 48" fill="none">
      <rect x="1" y="1" width="46" height="46" rx="14" fill={BLUE} />
      <path d="M12.5 35V18.5a6 6 0 0 1 6-6h9.2a6 6 0 0 1 4.24 1.76l3.56 3.56a6 6 0 0 1 1.76 4.24V35" stroke={PAPER} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18.5 35V25h12v10" stroke={PAPER} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="m21.5 20.5 2.4 2.4 5-5.2" stroke={OCHRE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="34.5" cy="12.5" r="2.3" fill={OCHRE} />
    </svg>
  );
}

/** A stylised QR block (decorative): finder squares plus a fixed pattern. */
function QrArt() {
  const cells = [
    '1110101', '1010011', '1110110', '0001010', '1101101', '0110011', '1011101',
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 34, borderRadius: 36, background: '#ffffff', boxShadow: '0 30px 60px rgba(12,27,51,0.35)' }}>
      {cells.map((row, y) => (
        <div key={y} style={{ display: 'flex', gap: 10 }}>
          {row.split('').map((cell, x) => (
            <div key={x} style={{ width: 34, height: 34, borderRadius: 8, background: cell === '1' ? BLUE : '#E7EDF1' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: `linear-gradient(135deg, ${BLUE} 0%, #0F2C45 100%)`, padding: '64px 72px', color: '#ffffff', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', borderRadius: 22, background: PAPER, padding: 4 }}><Mark px={76} /></div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: 2 }}>LASUATOS</span>
              <span style={{ fontSize: 24, color: '#B9CBDA' }}>Lagos State University</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <span style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}>Scan. Tap.</span>
            <span style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2, color: OCHRE }}>You’re marked present.</span>
            <span style={{ fontSize: 30, color: '#C9D7E3', marginTop: 6 }}>Lecture attendance in seconds — no app or account needed.</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 40 }}>
          <QrArt />
        </div>
      </div>
    ),
    size,
  );
}
