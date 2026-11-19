// Minimal type declarations for React 19, used because @types/react cannot be installed in this build environment
// (package installs are blocked). They cover only what the application uses; with network access, replace this file
// with the official @types/react and @types/react-dom packages.
declare module 'react' {
  export type ReactNode = any;
  export type SetState<T> = (v: T | ((prev: T) => T)) => void;
  export function useState<T>(init: T | (() => T)): [T, SetState<T>];
  export function useEffect(fn: () => void | (() => void) | (() => boolean), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
  export function useRef<T>(init: T): { current: T };
  export interface Context<T> { Provider: (p: { value: T; children?: ReactNode }) => any }
  export function createContext<T>(init: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
}
declare module 'react-dom/client' { export function createRoot(el: Element): { render(node: any): void } }
declare module 'react/jsx-runtime' { export const jsx: any, jsxs: any, Fragment: any; }
declare namespace JSX {
  type Element = any;
  type Field = HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
  interface DOMProps {
    [attr: string]: any;
    onChange?: (e: { target: Field; currentTarget: Field }) => void;
    onClick?: (e: MouseEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onMouseDown?: (e: MouseEvent & { target: EventTarget | null; currentTarget: EventTarget | null }) => void;
    onSubmit?: (e: SubmitEvent) => void;
  }
  interface IntrinsicElements { [name: string]: DOMProps }
  interface IntrinsicAttributes { key?: string | number | null }
  interface ElementChildrenAttribute { children: {} }
}
