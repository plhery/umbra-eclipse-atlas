'use client';

import { useEffect } from 'react';
import { initializeAnalytics, trackEvent, trackThrottled } from '@/lib/analytics';

export default function AtlasAnalytics() {
  useEffect(() => {
    initializeAnalytics();
    const onError = () => trackThrottled('service_error', { service: 'client', reason: 'runtime' }, 30_000);
    const onRejection = () => trackThrottled('service_error', { service: 'client', reason: 'promise' }, 30_000);
    const onFullscreen = () => trackEvent('map_fullscreen', { enabled: !!document.fullscreenElement });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);
  return null;
}
