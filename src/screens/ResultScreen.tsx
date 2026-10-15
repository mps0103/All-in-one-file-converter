import React, {useEffect} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated, {
  Easing,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {AnimatedNumber, enter} from '@/components/motion';
import {Card, GhostButton, GradientButton, Screen, ScreenHeader, SectionHeader, ToolRow} from '@/components/ui';
import {FileBridge} from '@/native/FileBridge';
import {openFile} from '@/navigation/openFile';
import {toolFor} from '@/tools/registry';
import {humanBytes} from '@/tools/helpers';
import {radius, spacing, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

export function ResultScreen({route, navigation}: Props) {
  const t = useTheme();
  const {toolId, result} = route.params;
  const tool = toolFor(toolId);
  const files = result.files;
  const main = files[0];

  const before = result.beforeBytes ?? 0;
  const after = result.afterBytes ?? 0;
  const smaller = before > 0 && after > 0 && after < before ? Math.round((1 - after / before) * 100) : 0;
  const showSizes = before > 0 && after > 0;

  // A ring ripples out from the tick, Market IQ style: one soft repeat.
  const ring = useSharedValue(0);
  useEffect(() => {
    ring.value = withDelay(250, withRepeat(withTiming(1, {duration: 1400, easing: Easing.out(Easing.quad)}), 2, false));
  }, [ring]);
  const ringStyle = useAnimatedStyle(() => ({opacity: 0.45 * (1 - ring.value), transform: [{scale: 1 + ring.value * 0.7}]}));

  const title = result.title
    ? result.title
    : result.info
    ? 'File details'
    : result.text
      ? 'Text extracted'
      : files.length > 1
        ? `${files.length} files saved`
        : `${tool.title} done!`;

  const open = () => main && openFile(main);
  const share = () => main && FileBridge.shareFile(main.uri, main.mime).catch(() => {});

  return (
    <Screen bottom>
      <ScreenHeader title={tool.title} onBack={navigation.goBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Animated.View style={[styles.ring, {backgroundColor: t.positive}, ringStyle]} />
          <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.tick, {backgroundColor: t.positive, shadowColor: t.positive}]}>
            <Icon name={result.info ? 'info' : 'check'} color="#fff" size={46} strokeWidth={3} />
          </Animated.View>
        </View>
        <Animated.Text entering={enter(1)} style={[type.h1, {color: t.text, textAlign: 'center'}]}>
          {title}
        </Animated.Text>
        {result.note ? (
          <Animated.Text entering={enter(2)} style={[type.body, {color: t.textMuted, textAlign: 'center', marginTop: spacing.sm}]}>
            {result.note}
          </Animated.Text>
        ) : null}

        {showSizes ? (
          <Animated.View entering={enter(3)}>
            <Card style={styles.sizes}>
              <View style={styles.sizeCol}>
                <Text style={[type.caption, {color: t.textMuted}]}>Original</Text>
                <Text style={[type.h2, {color: t.text, marginTop: 4}]}>{humanBytes(before)}</Text>
              </View>
              <View style={[styles.divider, {backgroundColor: t.border}]} />
              <View style={styles.sizeCol}>
                <Text style={[type.caption, {color: t.textMuted}]}>New</Text>
                <Text style={[type.h2, {color: t.text, marginTop: 4}]}>{humanBytes(after)}</Text>
              </View>
            </Card>
            {smaller > 0 ? (
              <View style={[styles.pill, {backgroundColor: t.positiveSoft}]}>
                <AnimatedNumber value={smaller} countUp format={v => `${Math.round(v)}% smaller`} style={[type.bodyNum, {color: t.positive}]} />
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {result.info ? (
          <Animated.View entering={enter(3)}>
            <Card style={{marginTop: spacing.xl}}>
              {result.info.map(r => (
                <View key={r.label} style={[styles.kv, {borderBottomColor: t.border}]}>
                  <Text style={[type.body, {color: t.textMuted, width: 104}]}>{r.label}</Text>
                  <Text selectable style={[type.body, {color: t.text, flex: 1, textAlign: 'right', fontWeight: '600'}]}>
                    {r.value}
                  </Text>
                </View>
              ))}
            </Card>
          </Animated.View>
        ) : null}

        {result.text ? (
          <Animated.View entering={enter(3)}>
            <SectionHeader title="Recognised text · long-press to copy" />
            <Card>
              <Text selectable style={[type.body, {color: t.text}]}>
                {result.text.length > 6000 ? `${result.text.slice(0, 6000)}…` : result.text}
              </Text>
            </Card>
          </Animated.View>
        ) : null}

        {files.length ? (
          <Animated.View entering={enter(4)}>
            <View style={[styles.where, {backgroundColor: t.cardAlt}]}>
              <Icon name="folder" color={t.textMuted} size={18} />
              <Text numberOfLines={2} style={[type.caption, {color: t.textMuted, flex: 1, marginLeft: spacing.sm}]}>
                Saved to {result.folder ?? main?.path ?? 'Downloads'}
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {files.length > 1 ? (
          <>
            <SectionHeader title="Files" />
            {files.slice(0, 30).map((f, i) => (
              <Animated.View key={f.uri} entering={enter(i + 5, 30)}>
                <ToolRow
                  title={f.name}
                  subtitle={f.size ? humanBytes(f.size) : undefined}
                  tint={tool.tint}
                  icon={tool.icon}
                  onPress={() => FileBridge.openFile(f.uri, f.mime).catch(() => {})}
                  right={<Icon name="open" color={t.textDim} size={18} />}
                />
              </Animated.View>
            ))}
            {files.length > 30 ? <Text style={[type.caption, {color: t.textMuted, textAlign: 'center'}]}>and {files.length - 30} more in the same folder</Text> : null}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {files.length === 1 ? (
          <>
            <GradientButton label="Open File" onPress={open} tint="blue" icon="open" />
            <View style={styles.row}>
              <GhostButton label="Share" icon="share" onPress={share} style={{flex: 1}} />
              <GhostButton label="Home" icon="home" onPress={() => navigation.popToTop()} style={{flex: 1, marginLeft: spacing.sm}} />
            </View>
          </>
        ) : (
          <View style={styles.row}>
            <GhostButton label="Do another" icon="refresh" onPress={navigation.goBack} style={{flex: 1}} />
            <GhostButton label="Home" icon="home" onPress={() => navigation.popToTop()} style={{flex: 1, marginLeft: spacing.sm}} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 24},
  hero: {alignItems: 'center', justifyContent: 'center', height: 150, marginTop: spacing.sm},
  ring: {position: 'absolute', width: 96, height: 96, borderRadius: 48},
  tick: {width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', elevation: 10, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: {width: 0, height: 8}},
  sizes: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl},
  sizeCol: {flex: 1, alignItems: 'center'},
  divider: {width: 1, height: 40},
  pill: {alignSelf: 'center', borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 7, marginTop: spacing.md},
  kv: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth},
  where: {flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl},
  footer: {paddingHorizontal: spacing.lg, paddingVertical: spacing.md},
  row: {flexDirection: 'row', marginTop: spacing.sm},
});
