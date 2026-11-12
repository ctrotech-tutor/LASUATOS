'use client';

import { Download, Share, SquarePlus } from 'lucide-react';
import { promptInstall, useInstallState } from '../lib/app-install';
import { useFeedback } from './feedback';

/**
 * "Install app" for browsers that support it, and step-by-step help on
 * iPhone, where installing goes through the Share menu. Hidden once installed.
 */
export function InstallAppButton({ className = 'button button-secondary', label = 'Install the app' }: Readonly<{ className?: string; label?: string }>) {
  const state = useInstallState();
  const feedback = useFeedback();
  if (state.kind === 'installed' || state.kind === 'unavailable') return null;

  async function install() {
    if (state.kind === 'promptable') {
      if (await promptInstall()) feedback.toast('LASUATOS is on your home screen.');
      return;
    }
    await feedback.confirm({
      title: 'Add LASUATOS to your Home Screen',
      body: (
        <ol className="ui-steps">
          <li><Share size={17} aria-hidden="true" /> Tap the <strong>Share</strong> button in Safari’s toolbar.</li>
          <li><SquarePlus size={17} aria-hidden="true" /> Choose <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. LASUATOS opens like any other app.</li>
        </ol>
      ),
      confirmLabel: 'Got it',
      cancelLabel: 'Close',
    });
  }

  return (
    <button className={className} type="button" onClick={() => void install()}>
      <Download size={17} aria-hidden="true" /> {label}
    </button>
  );
}
