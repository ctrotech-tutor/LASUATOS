import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContactRouter, ContactRouterFromLink } from '../../components/public/contact-router';
import { Tight } from '../../components/tight';
import '../pages.css';
import './contact.css';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Reach the right person for LASUATOS: your lecturer, class rep or HOC for attendance entries and class lists, or the LASUATOS team for departments, problems and privacy requests.',
};

/** An office routing slip: who fixes what, and what happens to a message for the team. */
function RoutingSlip() {
  return (
    <figure className="pg-receipt pg-slip pg-slip-route" aria-label="Who fixes what">
      <div className="pg-receipt-paper">
        <p className="pg-receipt-head">Routing slip</p>
        <p className="pg-receipt-sub">Who fixes what, fastest</p>
        <dl>
          <div><dt>Attendance entry</dt><dd>Lecturer or rep</dd></div>
          <div><dt>Name or matric</dt><dd>Your HOC</dd></div>
          <div><dt>Face or account</dt><dd>Your admin</dd></div>
        </dl>
        <p className="pg-receipt-label pg-slip-label">Everything else</p>
        <dl>
          <div><dt>To</dt><dd>LASUATOS team</dd></div>
          <div><dt>Reference</dt><dd>On every message</dd></div>
          <div><dt>Reply</dt><dd>Usually 2 working days</dd></div>
        </dl>
        <p className="pg-receipt-total"><span>Your message</span><strong className="pg-stamp-navy">Routed</strong></p>
      </div>
      <figcaption className="sr-only">Who fixes what: attendance entries go to the lecturer or class rep, names and matric numbers to your HOC, face checks and accounts to your department’s administrator. Everything else goes to the LASUATOS team, with a reference on every message and a reply usually within two working days.</figcaption>
    </figure>
  );
}

export default function ContactPage() {
  return (
    <div className="pg ct">
      <header className="pg-hero ct-hero">
        <div className="pg-wrap pg-hero-split">
          <div>
            <h1 className="pg-title"><Tight>Talk to the right person.</Tight></h1>
            <p className="pg-lede">
              Most attendance problems are fixed fastest by someone in your department. Choose what it’s about and we’ll point you to them, or straight to the LASUATOS team.
            </p>
          </div>
          <RoutingSlip />
        </div>
      </header>
      <div className="pg-wrap">
        {/* The server HTML has the full page; ?topic= is applied once the page runs. */}
        <Suspense fallback={<ContactRouter />}>
          <ContactRouterFromLink />
        </Suspense>
      </div>
    </div>
  );
}
