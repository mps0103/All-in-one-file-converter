import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {AnimatedNumber, haptic} from '@/components/motion';
import {Card, GhostButton, GradientButton, GradientTile, ProgressBar, Screen, ScreenHeader} from '@/components/ui';
import {useApp} from '@/hooks/AppState';
import {MediaTools} from '@/native/Tools';
import {toolFor, realId} from '@/tools/registry';
import {ensureStorageAccess, errorText, humanBytes} from '@/tools/helpers';
import {radius, spacing, tints, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Processing'>;

const STEPS = ['Reading file', 'Processing', 'Saving to your phone'];

export function ProcessingScreen({route, navigation}: Props) {
  const t = useTheme();
  const {toolId, files, options} = route.params;
  const tool = toolFor(toolId);
  const {recordConversion} = useApp();
  const [pct, setPct] = useState(2);
  const [label, setLabel] = useState('Getting ready');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const running = useRef(true);
  const [, deep] = tints[tool.tint];

  // Gentle breathing on the file icon while work is under way.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1.06, {duration: 700, easing: Easing.inOut(Easing.quad)}), withTiming(1, {duration: 700, easing: Easing.inOut(Easing.quad)})),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({transform: [{scale: pulse.value}]}));

  useEffect(() => {
    let alive = true;
    running.current = true;
    setError('');
    setPct(2);
    (async () => {
      try {
        if (!tool.free) await ensureStorageAccess();
        let probe;
        if (tool.media) {
          probe = await MediaTools.probe(files[0].uri).catch(() => undefined);
        }
        const result = await tool.run({
          files,
          o: options,
          probe,
          progress: (p, l) => {
            if (!alive) return;
            setPct(prev => Math.max(prev, Math.min(99, Math.round(p))));
            setLabel(l);
          },
        });
        if (!alive) return;
        running.current = false;
        setPct(100);
        setLabel('Done');
        haptic(14);
        if (result.files.length && !tool.free) {
          await recordConversion(realId(tool.id), result.files);
        }
        setTimeout(() => {
          if (alive) navigation.replace('Result', {toolId: tool.id, result, inputName: files[0]?.name ?? ''});
        }, 350);
      } catch (e) {
        if (!alive) return;
        running.current = false;
        const code = (e as {code?: string}).code;
        if (code === 'cancelled') {
          navigation.goBack();
          return;
        }
        setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
    // attempt re-runs the job on "Try again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Back while running: media jobs stop; others finish in a moment, so back waits.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!running.current) return false;
      if (tool.media) MediaTools.cancel();
      return true;
    });
    return () => sub.remove();
  }, [tool.media]);

  const step = pct < 15 ? 0 : pct < 90 ? 1 : 2;

  return (
    <Screen bottom>
      <ScreenHeader title="Processing" />
      <View style={styles.body}>
        <Animated.View entering={FadeIn.duration(220)} style={[styles.chip, {backgroundColor: t.cardAlt, borderColor: t.border}]}>
          <GradientTile tint={tool.tint} icon={tool.icon} size={24} r={7} />
          <Text style={[type.caption, {color: t.text, marginLeft: 8, fontWeight: '700'}]}>{tool.title}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(360)} style={{alignSelf: 'stretch'}}>
          <Card style={styles.card}>
            <Animated.View style={[styles.fileGlyph, {backgroundColor: t.infoSoft}, error ? null : pulseStyle]}>
              <Icon name={tool.icon} color={deep} size={46} strokeWidth={1.6} />
            </Animated.View>
            <Text numberOfLines={1} style={[type.h2, {color: t.text, marginTop: spacing.lg}]}>
              {files.length > 1 ? `${files.length} files` : files[0]?.name}
            </Text>
            <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>{humanBytes(files.reduce((a, f) => a + (f.size || 0), 0))}</Text>

            {error ? (
              <Animated.View entering={ZoomIn.duration(180)} style={[styles.error, {backgroundColor: t.negativeSoft}]}>
                <Icon name="alert" color={t.negative} size={20} />
                <Text style={[type.body, {color: t.text, flex: 1, marginLeft: spacing.sm}]}>{error}</Text>
              </Animated.View>
            ) : (
              <>
                <Text style={[type.title, {color: t.text, marginTop: spacing.xl}]}>{label}…</Text>
                <View style={styles.barRow}>
                  <View style={{flex: 1}}>
                    <ProgressBar percent={pct} color={deep} />
                  </View>
                  <AnimatedNumber value={pct} format={v => `${Math.round(v)}%`} style={[type.bodyNum, {color: t.text, width: 48, textAlign: 'right'}]} />
                </View>
                <View style={{alignSelf: 'stretch', marginTop: spacing.lg}}>
                  {STEPS.map((s, i) => {
                    const done = i < step || pct >= 100;
                    const now = i === step && pct < 100;
                    return (
                      <View key={s} style={styles.step}>
                        <View style={[styles.dot, {borderColor: done ? t.positive : now ? deep : t.borderStrong, backgroundColor: done ? t.positive : 'transparent'}]}>
                          {done ? <Icon name="check" color="#fff" size={13} strokeWidth={3} /> : null}
                        </View>
                        <Text style={[type.body, {color: done || now ? t.text : t.textDim, marginLeft: spacing.md}]}>{s}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </Card>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        {error ? (
          <>
            <GradientButton label="Try again" onPress={() => setAttempt(a => a + 1)} tint={tool.tint} icon="refresh" />
            <GhostButton label="Back" onPress={navigation.goBack} style={{marginTop: spacing.sm}} />
          </>
        ) : tool.media ? (
          <GhostButton label="Stop" icon="close" onPress={() => MediaTools.cancel()} />
        ) : (
          <Text style={[type.caption, {color: t.textDim, textAlign: 'center'}]}>Keep the app open until it finishes.</Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {flex: 1, alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md},
  chip: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 10, marginBottom: spacing.lg},
  card: {alignItems: 'center', paddingVertical: spacing.xxl},
  fileGlyph: {width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center'},
  barRow: {flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginTop: spacing.md},
  step: {flexDirection: 'row', alignItems: 'center', paddingVertical: 7},
  dot: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  error: {flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl, alignSelf: 'stretch'},
  footer: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xl},
});
