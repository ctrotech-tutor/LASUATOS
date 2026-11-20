// A little phone mockup for the install section: the LASUATOS icon sitting
// on a home screen, straight from the browser bar above it. Purely decorative
// (aria-hidden) - the words next to it do the explaining.
import { Check, Share } from 'lucide-react';
import { BrandMark } from './brand-mark';

/* Eight muted apps around the real one in the middle. */
const APPS = ['a', 'b', 'c', 'd', null, 'e', 'f', 'g', 'h'] as const;

export function InstallGraphic() {
  return (
    <div className="sg-phone" aria-hidden="true">
      <div className="sg-phone-screen">
        <div className="sg-phone-status">
          <span>9:41</span>
          <span className="sg-phone-signal"><i /><i /><i /></span>
        </div>
        <div className="sg-phone-browser">
          <span className="sg-phone-url">lasuatos.vercel.app</span>
          <span className="sg-phone-share"><Share size={11} /></span>
        </div>
        <div className="sg-phone-grid">
          {APPS.map((app) =>
            app === null ? (
              <span key="lasuatos" className="sg-phone-app is-lasu">
                <i><BrandMark className="sg-phone-mark" /></i>
                <b>LASUATOS</b>
              </span>
            ) : (
              <span key={app} className="sg-phone-app"><i /><u /></span>
            ),
          )}
        </div>
        <span className="sg-phone-toast"><Check size={10} /> Added to home screen</span>
      </div>
    </div>
  );
}
