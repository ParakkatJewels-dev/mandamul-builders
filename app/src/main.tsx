import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as auth from './lib/auth';
import { Login, SessionError, Shell, allowedScreens, useRoute, useSessionInfo } from './app';
import { Empty, Loading } from './ui/kit';
import { Command } from './screens/command';
import { Alerts } from './screens/alerts';
import { Approvals } from './screens/approvals';
import { Procurement } from './screens/procurement';
import { Site } from './screens/site';
import { Cost } from './screens/cost';
import { Feasibility } from './screens/feasibility';
import { Warranty } from './screens/warranty';
import { Contracts } from './screens/contracts';
import { Payments } from './screens/payments';

const SCREENS: Record<string, () => JSX.Element> = { command: Command, alerts: Alerts, approvals: Approvals, procurement: Procurement, site: Site, cost: Cost, feasibility: Feasibility, warranty: Warranty, contracts: Contracts, payments: Payments };

function Root() {
  const [session, setSession] = useState(auth.getSession());
  useEffect(() => auth.onSession(setSession), []);
  const { info, err, load } = useSessionInfo(!!session);
  const [route] = useRoute();
  if (!session) return <Login />;
  if (err) return <SessionError err={err} />;
  if (!info) return <div className="content"><Loading /></div>;
  const allowed = allowedScreens(info);
  const home = ['command', 'site', 'contracts', 'payments', 'alerts'].find(x => allowed.includes(x)) ?? 'alerts';
  if (route && SCREENS[route] && !allowed.includes(route))
    return <Shell info={info} refreshInfo={load} route={route}><div className="card" data-testid="not-allowed"><Empty title="This screen is not part of your role">Ask your administrator if you need it. Your other screens are in the menu.</Empty></div></Shell>;
  const id = SCREENS[route] ? route : home;
  const Screen = SCREENS[id];
  return <Shell info={info} refreshInfo={load} route={id}><Screen key={id} /></Shell>;
}

addEventListener('unhandledrejection', e => console.error('unhandled', e.reason));
createRoot(document.getElementById('root')!).render(<Root />);
