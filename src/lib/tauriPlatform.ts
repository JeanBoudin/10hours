export type Platform = 'desktop' | 'ios' | 'android';

export function detectPlatform(): Platform {
  if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
    return 'desktop';
  }
  return 'desktop';
}
