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

export default function ContactPage() {
  return (
    <div className="pg ct">
      <header className="pg-hero ct-hero">
        <div className="pg-wrap">
          <p className="pg-kicker">Contact</p>
          <h1 className="pg-title"><Tight>Talk to the right person.</Tight></h1>
          <p className="pg-lede">
            Most attendance problems are fixed fastest by someone in your department. Choose what it’s about and we’ll point you to them, or straight to the LASUATOS team.
          </p>
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
