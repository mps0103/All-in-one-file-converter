import {createNavigationContainerRef} from '@react-navigation/native';

import type {RootStackParamList} from './types';

/**
 * Lets the "Open with" handler steer the stack from outside the tree, where
 * there is no screen and so no useNavigation to call.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigate = <T extends keyof RootStackParamList>(
  name: T,
  params: RootStackParamList[T],
) => {
  if (!navigationRef.isReady()) return;
  // navigate() is overloaded per route name. This helper is generic over every
  // route at once, which the overload set cannot express, so the call is made
  // through a narrowed signature rather than casting both arguments away.
  const go = navigationRef.navigate as (screen: T, params: RootStackParamList[T]) => void;
  go(name, params);
};
