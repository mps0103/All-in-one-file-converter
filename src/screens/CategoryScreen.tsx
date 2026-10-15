import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {FadeIn} from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {PressableScale, enter} from '@/components/motion';
import {GradientTile, Screen, ScreenHeader, Segmented, ToolRow} from '@/components/ui';
import {CATEGORIES, CONVERT_TABS, toolsForTab, toolsIn} from '@/tools/registry';
import type {ConvertTab, Tool} from '@/tools/types';
import {radius, spacing, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Category'>;

export function CategoryScreen({route, navigation}: Props) {
  const t = useTheme();
  const cat = CATEGORIES.find(c => c.id === route.params.id)!;
  const [tab, setTab] = useState<ConvertTab>('Documents');
  const {width} = useWindowDimensions();
  const open = (tool: Tool) => navigation.navigate('Tool', {toolId: tool.id});

  const list = cat.id === 'convert' ? toolsForTab(tab) : toolsIn(cat.id);
  const tileW = (width - spacing.lg * 2 - spacing.md) / 2;

  return (
    <Screen bottom>
      <ScreenHeader title={cat.title} onBack={navigation.goBack} />
      {cat.id === 'convert' ? (
        <View style={{paddingHorizontal: spacing.lg, marginBottom: spacing.md}}>
          <Segmented options={CONVERT_TABS} value={tab} onChange={setTab} />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {cat.layout === 'grid' ? (
          <View style={styles.grid}>
            {list.map((tool, i) => (
              <Animated.View key={tool.id} entering={enter(i, 40)}>
                <PressableScale
                  onPress={() => open(tool)}
                  style={[styles.tile, {width: tileW, backgroundColor: t.card, borderColor: t.border}]}
                  accessibilityLabel={tool.title}>
                  <GradientTile tint={tool.tint} icon={tool.icon} size={50} />
                  <Text numberOfLines={1} style={[type.title, {color: t.text, marginTop: spacing.md}]}>
                    {tool.title}
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}
          </View>
        ) : (
          // Keyed on the tab so switching tabs replays the staggered entrance.
          <Animated.View key={tab} entering={FadeIn.duration(160)}>
            {list.map((tool, i) => (
              <Animated.View key={tool.id} entering={enter(i, 45)}>
                <ToolRow title={tool.title} subtitle={tool.subtitle} tint={tool.tint} icon={tool.icon} onPress={() => open(tool)} />
              </Animated.View>
            ))}
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 32},
  grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md},
  tile: {borderWidth: 1, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.sm},
});
