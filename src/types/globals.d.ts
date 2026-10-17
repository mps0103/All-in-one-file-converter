// React Native provides these at run time (Libraries/Core/Timers), but its global
// types are not loaded here — tsconfig keeps "types" empty on purpose.
declare function requestIdleCallback(callback: (deadline: {didTimeout: boolean; timeRemaining: () => number}) => void, options?: {timeout?: number}): number;
declare function cancelIdleCallback(handle: number): void;
