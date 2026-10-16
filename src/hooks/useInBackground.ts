import {useEffect, useState} from 'react';
import {AppState, DeviceEventEmitter} from 'react-native';

/**
 * True while the app is out of sight: in the background, or told by Android to
 * trim its memory (MainApplication's "memoryTrim") and not in front. Screens
 * that show pictures draw none while it is true, so the bitmaps behind them can
 * be freed; every one of them is a file in the cache and is read back on return.
 */
export function useInBackground() {
  const [hidden, setHidden] = useState(AppState.currentState === 'background');
  useEffect(() => {
    const app = AppState.addEventListener('change', s => setHidden(s === 'background'));
    // A trim while the app is in front means the phone is short of memory, not that
    // the screen is gone: what is on screen stays.
    const trim = DeviceEventEmitter.addListener('memoryTrim', () => setHidden(AppState.currentState !== 'active'));
    return () => {
      app.remove();
      trim.remove();
    };
  }, []);
  return hidden;
}
