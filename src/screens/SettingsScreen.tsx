import React, {useCallback, useEffect, useState} from 'react';
import {Linking, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated from 'react-native-reanimated';
import {useFocusEffect, useNavigation} from '@react-navigation/native';

import {Icon, type IconName} from '@/components/Icon';
import {PressableScale, enter} from '@/components/motion';
import {Card, GradientFill, InfoSheet, Screen, ScreenHeader, SectionHeader, Segmented, ToggleRow} from '@/components/ui';
import {useApp} from '@/hooks/AppState';
import {IS_DEBUG_BUILD} from '@/native/FileBridge';
import {Workbench} from '@/native/Tools';
import {manageSubscriptionUrl} from '@/services/billing';
import {privacyOptionsRequired, showPrivacyOptions} from '@/services/ads';
import {humanBytes} from '@/tools/helpers';
import {radius, spacing, type, useTheme, useThemeMode, type ThemeMode} from '@/theme';

export const APP_VERSION = '1.0.0';
const PRIVACY_URL = 'https://mps0103.github.io/All-in-one-file-converter/privacy-policy.html';
const TERMS_URL = 'https://mps0103.github.io/All-in-one-file-converter/terms-of-use.html';
const SUPPORT_EMAIL = 'info@dealtrix.com';

/** MP3 saving uses LAME, which is LGPL: users must be told, and where to get its source. */
const LAME_URL = 'https://lame.sourceforge.io';
const LAME_NOTICE =
  'MP3 encoding uses LAME 3.100, © the LAME project, licensed under the GNU Library General Public License (LGPL) version 2. ' +
  'It is included unmodified as a separate library (libmp3lame.so), and its source code is available from lame.sourceforge.io.';

/**
 * Every open-source component the app ships, each licence read from the package
 * itself (package.json for JS, the Maven POM or jar manifest for Android).
 */
const LICENCES: {name: string; licence: string; url: string}[] = [
  {name: 'LAME 3.100', licence: 'LGPL 2', url: LAME_URL},
  {name: 'PDFBox-Android 2.0.27', licence: 'Apache 2.0', url: 'https://github.com/TomRoush/PdfBox-Android'},
  {name: 'zip4j 2.11.5', licence: 'Apache 2.0', url: 'https://github.com/srikanth-lingala/zip4j'},
  {name: 'Apache Commons Compress 1.27.1', licence: 'Apache 2.0', url: 'https://commons.apache.org/proper/commons-compress/'},
  {name: 'XZ for Java 1.10', licence: '0BSD', url: 'https://tukaani.org/xz/java.html'},
  {name: 'junrar 7.5.5', licence: 'UnRAR licence', url: 'https://github.com/junrar/junrar'},
  {name: 'pdf-lib 1.17.1', licence: 'MIT', url: 'https://pdf-lib.js.org'},
  {name: 'mammoth 1.9.0', licence: 'BSD-2-Clause', url: 'https://github.com/mwilliamson/mammoth.js'},
  {name: 'SheetJS xlsx 0.18.5', licence: 'Apache 2.0', url: 'https://sheetjs.com'},
  {name: 'docx 9.1.1', licence: 'MIT', url: 'https://docx.js.org'},
  {name: 'JSZip 3.10.1', licence: 'MIT or GPLv3', url: 'https://stuk.github.io/jszip/'},
  {name: 'React Native 0.77', licence: 'MIT', url: 'https://reactnative.dev'},
  {name: 'React Native Reanimated 3.19', licence: 'MIT', url: 'https://docs.swmansion.com/react-native-reanimated'},
  {name: 'react-native-svg 15.13', licence: 'MIT', url: 'https://github.com/software-mansion/react-native-svg'},
  {name: 'react-native-webview 13.16', licence: 'MIT', url: 'https://github.com/react-native-webview/react-native-webview'},
  {name: 'react-native-document-scanner-plugin 2.0.4', licence: 'MIT', url: 'https://github.com/websitebeaver/react-native-document-scanner-plugin'},
  {name: 'AndroidX Media3 1.5.1', licence: 'Apache 2.0', url: 'https://developer.android.com/media/media3'},
  {name: 'Google ML Kit', licence: 'ML Kit Terms', url: 'https://developers.google.com/ml-kit/terms'},
];

export function SettingsScreen() {
  const t = useTheme();
  const {mode, setMode} = useThemeMode();
  const nav = useNavigation<any>();
  const {premium, refreshEntitlement, testEntitlement, setTestPremium, resetFreeQuota} = useApp();
  const [cache, setCache] = useState(0);
  const [adChoices, setAdChoices] = useState(false);
  const [about, setAbout] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Workbench.cacheSize().then(setCache).catch(() => {});
    }, []),
  );
  useEffect(() => {
    privacyOptionsRequired().then(setAdChoices).catch(() => {});
  }, []);

  let i = 0;
  return (
    <Screen>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!premium ? (
          <Animated.View entering={enter(i++)}>
            <PressableScale onPress={() => nav.navigate('PremiumModal')} style={styles.promo}>
              <GradientFill colors={['#A855F7', '#E0313A']} r={radius.lg} />
              <Icon name="crown" color="#FFD54A" size={30} />
              <View style={{flex: 1, marginLeft: spacing.md}}>
                <Text style={[type.h2, {color: '#fff'}]}>Go Premium</Text>
                <Text style={[type.caption, {color: 'rgba(255,255,255,0.85)', marginTop: 2}]}>Unlock all features</Text>
              </View>
              <Icon name="chevron" color="#fff" size={22} />
            </PressableScale>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(i++)}>
          <Card style={styles.group}>
            {premium ? <Row icon="crown" label="Manage Subscription" onPress={() => Linking.openURL(manageSubscriptionUrl)} /> : null}
            <Row icon="restore" label="Restore Purchase" onPress={refreshEntitlement} last />
          </Card>
        </Animated.View>

        <SectionHeader title="Appearance" />
        <Animated.View entering={enter(i++)}>
          <Card>
            <ToggleRow label="Dark Mode" hint={mode === 'system' ? 'Following the phone' : undefined} value={t.isDark} onChange={v => setMode(v ? 'dark' : 'light')} />
            <View style={{marginTop: spacing.sm}}>
              <Segmented<ThemeMode> options={['system', 'dark', 'light']} labels={{system: 'System', dark: 'Dark', light: 'Light'}} value={mode} onChange={setMode} />
            </View>
          </Card>
        </Animated.View>

        <SectionHeader title="General" />
        <Animated.View entering={enter(i++)}>
          <Card style={styles.group}>
            <Row
              icon="cache"
              label="Clear Cache"
              value={humanBytes(cache)}
              onPress={async () => {
                await Workbench.clearCache().catch(() => 0);
                setCache(await Workbench.cacheSize().catch(() => 0));
              }}
            />
            {adChoices ? <Row icon="shield" label="Ad Privacy Choices" onPress={() => showPrivacyOptions()} /> : null}
            <Row icon="policy" label="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
            <Row icon="doc" label="Terms of Service" onPress={() => Linking.openURL(TERMS_URL)} />
            <Row icon="mail" label="Contact Support" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=All-in-One%20File%20Converter`)} />
            <Row icon="info" label="About" value={`Version ${APP_VERSION}`} onPress={() => setAbout(true)} last />
          </Card>
        </Animated.View>

        {IS_DEBUG_BUILD ? (
          <>
            <SectionHeader title="Testing (debug build only)" />
            <Card>
              <Segmented
                options={['real', 'free', 'premium']}
                labels={{real: 'Real', free: 'Free', premium: 'Premium'}}
                value={testEntitlement ?? 'real'}
                onChange={v => setTestPremium(v === 'real' ? null : (v as 'free' | 'premium'))}
              />
              <Pressable onPress={resetFreeQuota} style={{marginTop: spacing.md}}>
                <Text style={[type.caption, {color: t.info, fontWeight: '700'}]}>Reset free conversions</Text>
              </Pressable>
            </Card>
          </>
        ) : null}

        <Text style={[type.caption, {color: t.textDim, textAlign: 'center', marginTop: spacing.xl}]}>All-in-One File Converter · by MPS{'\n'}Every tool runs on your phone. Nothing is uploaded.</Text>
      </ScrollView>

      <InfoSheet visible={about} onClose={() => setAbout(false)} title={`About · Version ${APP_VERSION}`}>
        <Text style={[type.body, {color: t.textMuted, lineHeight: 21}]}>{LAME_NOTICE}</Text>
        <SectionHeader title="Open-source licences" />
        <Card style={styles.group}>
          {LICENCES.map((l, i) => (
            <Row key={l.name} icon="policy" label={l.name} value={l.licence} onPress={() => Linking.openURL(l.url)} last={i === LICENCES.length - 1} />
          ))}
        </Card>
      </InfoSheet>
    </Screen>
  );
}

function Row({icon, label, value, onPress, last}: {icon: IconName; label: string; value?: string; onPress?: () => void; last?: boolean}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({pressed}) => [styles.row, !last && {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border}, {opacity: pressed ? 0.6 : 1}]}>
      <Icon name={icon} color={t.textMuted} size={21} />
      <Text style={[type.title, {color: t.text, flex: 1, marginLeft: spacing.md}]}>{label}</Text>
      {value ? <Text style={[type.caption, {color: t.textMuted, marginRight: onPress ? 6 : 0}]}>{value}</Text> : null}
      {onPress ? <Icon name="chevron" color={t.textDim} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 40},
  promo: {flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, padding: spacing.lg, overflow: 'hidden', marginBottom: spacing.md, elevation: 6, shadowColor: '#A855F7', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: {width: 0, height: 6}},
  group: {paddingVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center', minHeight: 52},
});
