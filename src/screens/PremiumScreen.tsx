import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated, {Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming} from 'react-native-reanimated';
import {useNavigation} from '@react-navigation/native';

import {Icon} from '@/components/Icon';
import {PressableScale, enter, haptic} from '@/components/motion';
import {AppDialog, Card, GhostButton, GradientButton, GradientFill, Screen, ScreenHeader} from '@/components/ui';
import {useApp} from '@/hooks/AppState';
import {buy, loadPlans, manageSubscriptionUrl, type Plan} from '@/services/billing';
import {radius, spacing, type, useTheme} from '@/theme';

const BENEFITS: {icon: 'sparkle' | 'shield' | 'layers' | 'star'; text: string}[] = [
  {icon: 'sparkle', text: 'Unlimited conversions in every tool'},
  {icon: 'shield', text: 'No ads, ever'},
  {icon: 'layers', text: 'Batch files, long videos and big PDFs'},
  {icon: 'star', text: 'Every new tool as it arrives'},
];

export function PremiumScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const {premium, entitlement, refreshEntitlement} = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isModal = nav.getState()?.type === 'stack';

  // The crown floats gently, the one decorative loop on this screen.
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(withSequence(withTiming(1, {duration: 1600, easing: Easing.inOut(Easing.sin)}), withTiming(0, {duration: 1600, easing: Easing.inOut(Easing.sin)})), -1);
  }, [float]);
  const floatStyle = useAnimatedStyle(() => ({transform: [{translateY: -6 * float.value}, {rotate: `${-4 + 8 * float.value}deg`}]}));

  const fetchPlans = async () => {
    setLoading(true);
    const list = await loadPlans();
    setPlans(list);
    setSelected(list.find(p => p.kind === 'subscription')?.id ?? list[0]?.id ?? null);
    setLoading(false);
  };
  useEffect(() => {
    fetchPlans();
  }, []);

  const purchase = async () => {
    const plan = plans.find(p => p.id === selected);
    if (!plan) return;
    try {
      await buy(plan);
      await refreshEntitlement();
    } catch (e) {
      if ((e as {code?: string}).code !== 'E_USER_CANCELLED') setMessage('The purchase did not go through. Nothing was charged.');
    }
  };

  const restore = async () => {
    await refreshEntitlement();
    setMessage(null);
  };

  return (
    <Screen bottom={isModal}>
      <ScreenHeader title="Premium" onBack={isModal ? () => nav.goBack() : undefined} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={enter(0)}>
          <View style={styles.hero}>
            <GradientFill colors={['#FFB547', '#E0313A']} r={radius.xl} />
            <Animated.View style={floatStyle}>
              <Icon name="crown" color="#fff" size={56} strokeWidth={1.8} />
            </Animated.View>
            <Text style={[type.h1, styles.heroTitle]}>{premium ? 'Premium is on' : 'Go Premium'}</Text>
            <Text style={[type.body, styles.heroSub]}>
              {premium ? (entitlement.kind === 'lifetime' ? 'Unlocked for life. Thank you!' : 'Your subscription is active. Thank you!') : 'Unlimited conversions in every tool.'}
            </Text>
          </View>
        </Animated.View>

        <Card style={{marginTop: spacing.lg}}>
          {BENEFITS.map((b, i) => (
            <Animated.View key={b.text} entering={enter(i + 1, 70)} style={styles.benefit}>
              <View style={[styles.benefitIcon, {backgroundColor: t.warningSoft}]}>
                <Icon name={b.icon} color={t.warning} size={18} />
              </View>
              <Text style={[type.body, {color: t.text, flex: 1, marginLeft: spacing.md}]}>{b.text}</Text>
              <Icon name="check" color={t.positive} size={18} strokeWidth={2.6} />
            </Animated.View>
          ))}
        </Card>

        {premium ? (
          entitlement.kind !== 'lifetime' ? (
            <GhostButton label="Manage subscription" icon="settings" onPress={() => Linking.openURL(manageSubscriptionUrl)} style={{marginTop: spacing.xl}} />
          ) : null
        ) : loading ? (
          <ActivityIndicator color={t.info} style={{marginTop: spacing.xxl}} />
        ) : plans.length ? (
          <View style={{marginTop: spacing.lg}}>
            {plans.map((p, i) => {
              const on = p.id === selected;
              return (
                <Animated.View key={p.id} entering={enter(i + 5, 70)}>
                  <PressableScale
                    onPress={() => {
                      haptic(6);
                      setSelected(p.id);
                    }}
                    style={[styles.plan, {backgroundColor: t.card, borderColor: on ? t.warning : t.border}]}>
                    <View style={[styles.radio, {borderColor: on ? t.warning : t.borderStrong}]}>{on ? <View style={[styles.radioDot, {backgroundColor: t.warning}]} /> : null}</View>
                    <View style={{flex: 1, marginLeft: spacing.md}}>
                      <Text style={[type.title, {color: t.text}]}>{p.kind === 'lifetime' ? 'Lifetime' : 'Monthly'}</Text>
                      <Text style={[type.caption, {color: t.textMuted, marginTop: 2}]}>{p.kind === 'lifetime' ? 'Pay once, keep forever' : 'Cancel any time in Play Store'}</Text>
                    </View>
                    <Text style={[type.h2, {color: t.text}]}>{p.price}</Text>
                  </PressableScale>
                </Animated.View>
              );
            })}
            <GradientButton label="Continue" onPress={purchase} tint="gold" icon="crown" style={{marginTop: spacing.md}} />
          </View>
        ) : (
          <Card style={{marginTop: spacing.lg, alignItems: 'center'}}>
            <Text style={[type.body, {color: t.textMuted, textAlign: 'center'}]}>Plans could not be loaded. Check the connection and Google Play, then try again.</Text>
            <GhostButton label="Try again" icon="refresh" onPress={fetchPlans} style={{marginTop: spacing.md, alignSelf: 'stretch'}} />
          </Card>
        )}

        {!premium ? (
          <Text onPress={restore} style={[type.caption, {color: t.info, textAlign: 'center', marginTop: spacing.lg, fontWeight: '700'}]}>
            Restore purchase
          </Text>
        ) : null}
      </ScrollView>

      <AppDialog visible={!!message} onClose={() => setMessage(null)} title="Purchase" message={message ?? ''} actions={[{label: 'OK', tone: 'primary', onPress: () => setMessage(null)}]} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 40},
  hero: {borderRadius: radius.xl, alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, overflow: 'hidden', elevation: 8, shadowColor: '#FF7A1A', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: {width: 0, height: 8}},
  heroTitle: {color: '#fff', marginTop: spacing.md},
  heroSub: {color: 'rgba(255,255,255,0.9)', marginTop: 4, textAlign: 'center'},
  benefit: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8},
  benefitIcon: {width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  plan: {flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm},
  radio: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  radioDot: {width: 10, height: 10, borderRadius: 5},
});
