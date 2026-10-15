import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {enter} from '@/components/motion';
import {Card, GhostButton, Screen, ScreenHeader, SectionHeader, ToolRow} from '@/components/ui';
import {FileBridge} from '@/native/FileBridge';
import {toolsForMime} from '@/tools/registry';
import {humanBytes} from '@/tools/helpers';
import {radius, spacing, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OpenWith'>;

/** A file opened or shared from another app: pick what to do with it. */
export function OpenWithScreen({route, navigation}: Props) {
  const t = useTheme();
  const {file} = route.params;
  const tools = toolsForMime(file.mime, file.name);

  return (
    <Screen bottom>
      <ScreenHeader title="What should I do?" onBack={navigation.goBack} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enter(0)}>
          <Card style={styles.file}>
            <View style={[styles.glyph, {backgroundColor: t.infoSoft}]}>
              <Icon name="doc" color={t.info} size={24} />
            </View>
            <View style={{flex: 1, marginLeft: spacing.md}}>
              <Text numberOfLines={2} style={[type.title, {color: t.text}]}>
                {file.name}
              </Text>
              <Text style={[type.caption, {color: t.textMuted, marginTop: 3}]}>{humanBytes(file.size)}</Text>
            </View>
          </Card>
        </Animated.View>

        <SectionHeader title="Tools for this file" />
        <Animated.View entering={enter(1, 35)}>
          <ToolRow title="View File" subtitle="Read it without converting it" tint="teal" icon="eye" onPress={() => navigation.replace('Viewer', {file})} />
        </Animated.View>
        {tools.map((tool, i) => (
          <Animated.View key={tool.id} entering={enter(i + 2, 35)}>
            <ToolRow title={tool.title} subtitle={tool.subtitle} tint={tool.tint} icon={tool.icon} onPress={() => navigation.replace('Tool', {toolId: tool.id, files: [file]})} />
          </Animated.View>
        ))}
        {!tools.length ? (
          <Text style={[type.body, {color: t.textMuted, textAlign: 'center', marginTop: spacing.xl}]}>No tool in this app works on this type of file yet.</Text>
        ) : null}
        <GhostButton label="Open in another app" icon="open" onPress={() => FileBridge.openFile(file.uri, file.mime || '*/*').catch(() => {})} style={{marginTop: spacing.lg}} />
        <GhostButton label="File info" icon="info" onPress={() => navigation.replace('Tool', {toolId: 'file-info', files: [file]})} style={{marginTop: spacing.sm}} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 40},
  file: {flexDirection: 'row', alignItems: 'center'},
  glyph: {width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center'},
});
