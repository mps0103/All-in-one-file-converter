import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated, {FadeOut, LinearTransition} from 'react-native-reanimated';

import {Icon, type IconName} from '@/components/Icon';
import {enter} from '@/components/motion';
import {AppDialog, Card, Chip, GradientTile, Screen, ScreenHeader} from '@/components/ui';
import {useApp} from '@/hooks/AppState';
import {FileBridge} from '@/native/FileBridge';
import {openFile} from '@/navigation/openFile';
import type {HistoryItem} from '@/services/history';
import {spacing, type, useTheme, type TintName} from '@/theme';

type Filter = 'All' | 'PDF' | 'Docs' | 'Images' | 'Audio' | 'Video' | 'Archives';
const FILTERS: Filter[] = ['All', 'PDF', 'Docs', 'Images', 'Audio', 'Video', 'Archives'];

const kindOf = (h: HistoryItem): Exclude<Filter, 'All'> => {
  const m = (h.mime || '').toLowerCase();
  const e = (h.name.split('.').pop() || '').toLowerCase();
  if (m === 'application/pdf' || e === 'pdf') return 'PDF';
  if (m.startsWith('image/')) return 'Images';
  if (m.startsWith('audio/') || ['m4a', 'aac', 'wav'].includes(e)) return 'Audio';
  if (m.startsWith('video/') || e === 'mp4') return 'Video';
  if (/zip|7z|tar|gzip|bzip|xz|rar/.test(m) || ['zip', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(e)) return 'Archives';
  return 'Docs';
};

const LOOK: Record<Exclude<Filter, 'All'>, {tint: TintName; icon: IconName}> = {
  PDF: {tint: 'red', icon: 'pdf'},
  Docs: {tint: 'blue', icon: 'doc'},
  Images: {tint: 'orange', icon: 'image'},
  Audio: {tint: 'green', icon: 'music'},
  Video: {tint: 'purple', icon: 'video'},
  Archives: {tint: 'yellow', icon: 'zip'},
};

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same ? d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : d.toLocaleDateString();
};

export function FilesScreen() {
  const t = useTheme();
  const {history, forgetHistoryItem, wipeHistory} = useApp();
  const [filter, setFilter] = useState<Filter>('All');
  const [confirm, setConfirm] = useState(false);
  const items = useMemo(() => history.filter(h => h.kind !== 'viewed').filter(h => filter === 'All' || kindOf(h) === filter), [history, filter]);

  return (
    <Screen>
      <ScreenHeader
        title="My Files"
        subtitle="Everything this app has made"
        right={
          history.length ? (
            <Pressable onPress={() => setConfirm(true)} hitSlop={10} accessibilityLabel="Clear list">
              <Icon name="trash" color={t.textMuted} size={21} />
            </Pressable>
          ) : null
        }
      />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map(f => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!items.length ? (
          <Animated.View entering={enter(0)} style={styles.empty}>
            <GradientTile tint="blue" icon="folder" size={72} />
            <Text style={[type.h2, {color: t.text, marginTop: spacing.lg}]}>No files yet</Text>
            <Text style={[type.body, {color: t.textMuted, textAlign: 'center', marginTop: spacing.sm}]}>
              Files you convert, compress or create show up here. They are saved in your Downloads folder.
            </Text>
          </Animated.View>
        ) : (
          items.map((h, i) => {
            const look = LOOK[kindOf(h)];
            return (
              <Animated.View key={h.id} entering={enter(i, 30)} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)}>
                <Card onPress={() => openFile(h)} style={styles.row} accessibilityLabel={h.name}>
                  <GradientTile tint={look.tint} icon={look.icon} size={44} />
                  <View style={{flex: 1, marginHorizontal: spacing.md}}>
                    <Text numberOfLines={1} style={[type.title, {color: t.text}]}>
                      {h.name}
                    </Text>
                    <Text numberOfLines={1} style={[type.caption, {color: t.textMuted, marginTop: 3}]}>
                      {when(h.at)} · {h.path || 'Downloads'}
                    </Text>
                  </View>
                  <Pressable onPress={() => FileBridge.shareFile(h.uri, h.mime).catch(() => {})} hitSlop={8} style={styles.icon} accessibilityLabel="Share">
                    <Icon name="share" color={t.textMuted} size={19} />
                  </Pressable>
                  <Pressable onPress={() => forgetHistoryItem(h.id)} hitSlop={8} style={styles.icon} accessibilityLabel="Remove from list">
                    <Icon name="close" color={t.textMuted} size={19} />
                  </Pressable>
                </Card>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      <AppDialog
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Clear the list?"
        message="Only the list is cleared. The files stay in your Downloads folder."
        actions={[
          {label: 'Cancel', onPress: () => setConfirm(false)},
          {
            label: 'Clear',
            tone: 'danger',
            onPress: () => {
              setConfirm(false);
              wipeHistory();
            },
          },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {paddingHorizontal: spacing.lg, paddingBottom: spacing.md},
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 32},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm + 2},
  icon: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center'},
  empty: {alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.xl},
});
