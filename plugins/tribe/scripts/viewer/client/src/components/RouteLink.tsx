// client/src/components/RouteLink.tsx — a real `<a href>` to one of the client's own routes.
//
// A plain left click navigates in-app through `onNavigate`, which `App` owns: it pushes the address
// AND sets the route state. A bare `pushState` is not enough — `App` re-reads the route only on
// `popstate`, which `pushState` never fires. A modified or middle click keeps the browser's own
// behaviour (new tab, new window), and without `onNavigate` the link falls back to a full page load
// of the same address, which the server answers with the shell.
import type { MouseEvent, ReactNode } from 'react';
import { routeToPath, type ClientRoute } from '../routes.ts';

export interface RouteLinkProps {
  route: ClientRoute;
  onNavigate?: (route: ClientRoute) => void;
  className?: string;
  children: ReactNode;
}

export function RouteLink({ route, onNavigate, className, children }: RouteLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate === undefined) return;
    const opensElsewhere = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (opensElsewhere) return;
    event.preventDefault();
    onNavigate(route);
  };
  return (
    <a className={className} href={routeToPath(route)} onClick={onClick}>
      {children}
    </a>
  );
}
