import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {FadeIn, LinearTransition} from 'react-native-reanimated';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {PressableScale, enter} from '@/components/motion';
import {GradientFill, GradientTile, Screen, SearchBar, SectionHeader, ToolRow} from '@/components/ui';
import {useApp} from '@/hooks/AppState';
import {CATEGORIES, searchTools, toolFor} from '@/tools/registry';
import {radius, spacing, tints, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';
import {openFile} from '@/navigation/openFile';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const QUICK = ['pdf-compress', 'pdf-merge', 'video-to-audio', 'image-compress', 'audio-trim', 'extract-archive'];

export function HomeScreen() {
  const t = useTheme();
  const nav = useNavigation<Nav>();
  const {premium, remaining, history} = useApp();
  const [q, setQ] = useState('');
  const {width} = useWindowDimensions();
  const cardW = (width - spacing.lg * 2 - spacing.md) / 2;

  const results = useMemo(() => searchTools(q), [q]);
  const recent = history.filter(h => h.kind !== 'viewed').slice(0, 3);

  return (
    <Screen>
      <View style={styles.top}>
        <GradientTile tint="blue" icon="convert" size={40} />
        <View style={{flex: 1, marginLeft: spacing.md}}>
          <Text style={[type.h1, {color: t.text}]}>File Converter</Text>
          <Text style={[type.caption, {color: t.textMuted, marginTop: 1}]}>All-in-One Tools</Text>
        </View>
        {!premium ? (
          <PressableScale onPress={() => nav.navigate('PremiumModal')} style={[styles.crown, {backgroundColor: t.warningSoft}]} accessibilityLabel="Go Premium">
            <Icon name="crown" color="#FFB020" size={22} strokeWidth={2.1} />
          </PressableScale>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search tools or files..." />

        {q.trim() ? (
          <Animated.View entering={FadeIn.duration(200)} style={{marginTop: spacing.lg}}>
            {results.length ? (
              results.map((tool, i) => (
                <Animated.View key={tool.id} entering={enter(i, 35)} layout={LinearTransition.duration(220)}>
                  <ToolRow title={tool.title} subtitle={tool.subtitle} tint={tool.tint} icon={tool.icon} onPress={() => nav.navigate('Tool', {toolId: tool.id})} />
                </Animated.View>
              ))
            ) : (
              <Text style={[type.body, {color: t.textMuted, textAlign: 'center', marginTop: spacing.xl}]}>No tool matches “{q.trim()}”.</Text>
            )}
          </Animated.View>
        ) : (
          <>
            <View style={styles.grid}>
              {CATEGORIES.map((c, i) => (
                <Animated.View key={c.id} entering={enter(i)}>
                  <PressableScale
                    onPress={() => nav.navigate('Category', {id: c.id})}
                    style={[styles.cat, {width: cardW, height: cardW * 0.82, shadowColor: tints[c.tint][1]}]}
                    accessibilityLabel={c.title}>
                    <GradientFill tint={c.tint} r={radius.xl} />
                    <View style={styles.catGloss} />
                    <Icon name={c.icon} color="#fff" size={Math.round(cardW * 0.26)} strokeWidth={2} />
                    <Text style={[type.title, styles.catLabel]}>{c.title}</Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>

            {!premium && Number.isFinite(remaining) ? (
              <Animated.View entering={enter(6)}>
                <Pressable onPress={() => nav.navigate('PremiumModal')} style={[styles.quota, {backgroundColor: t.card, borderColor: t.border}]}>
                  <Icon name="sparkle" color={t.warning} size={20} />
                  <Text style={[type.caption, {color: t.textMuted, flex: 1, marginLeft: spacing.sm}]}>
                    <Text style={{color: t.text, fontWeight: '700'}}>{remaining}</Text> free conversion{remaining === 1 ? '' : 's'} left
                  </Text>
                  <Text style={[type.caption, {color: t.info, fontWeight: '700'}]}>Go unlimited</Text>
                </Pressable>
              </Animated.View>
            ) : null}

            <SectionHeader title="Popular tools" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingRight: spacing.lg}}>
              {QUICK.map((id, i) => {
                const tool = toolFor(id);
                return (
                  <Animated.View key={id} entering={enter(i + 6, 40)}>
                    <PressableScale onPress={() => nav.navigate('Tool', {toolId: id})} style={[styles.quick, {backgroundColor: t.card, borderColor: t.border}]}>
                      <GradientTile tint={tool.tint} icon={tool.icon} size={40} />
                      <Text numberOfLines={2} style={[type.caption, {color: t.text, marginTop: spacing.sm, textAlign: 'center', fontWeight: '600'}]}>
                        {tool.title}
                      </Text>
                    </PressableScale>
                  </Animated.View>
                );
              })}
            </ScrollView>

            {recent.length ? (
              <>
                <SectionHeader title="Recent files" action="See all" onAction={() => (nav as unknown as {navigate: (s: string) => void}).navigate('Files')} />
                {recent.map((h, i) => {
                  let tool;
                  try {
                    tool = h.toolId ? toolFor(h.toolId) : undefined;
                  } catch {
                    tool = undefined;
                  }
                  return (
                    <Animated.View key={h.id} entering={enter(i + 10, 40)}>
                      <ToolRow
                        title={h.name}
                        subtitle={tool?.title ?? 'Saved file'}
                        tint={tool?.tint ?? 'blue'}
                        icon={tool?.icon ?? 'doc'}
                        onPress={() => openFile(h)}
                        right={<Icon name="open" color={t.textDim} size={18} />}
                      />
                    </Animated.View>
                  );
                })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md},
  crown: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 40},
  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: spacing.lg, rowGap: spacing.md},
  cat: {
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 8,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
  },
  catGloss: {position: 'absolute', top: -40, left: -30, width: 140, height: 110, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.13)'},
  catLabel: {color: '#fff', fontWeight: '700', marginTop: spacing.md, fontSize: 15.5},
  quota: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg},
  quick: {width: 104, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', marginRight: spacing.sm, minHeight: 112},
});
