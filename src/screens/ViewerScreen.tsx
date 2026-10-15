import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {WebView} from 'react-native-webview';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {FadeIn, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {PressableScale, enter} from '@/components/motion';
import {Card, Field, GhostButton, GradientButton, GradientTile, Screen, ScreenHeader, SkeletonBlock} from '@/components/ui';
import {buildPreview, previewKindFor, type Preview} from '@/convert/preview';
import {useApp} from '@/hooks/AppState';
import {FileBridge, isCancelled, isPasswordError, type PickedFile} from '@/native/FileBridge';
import {humanBytes} from '@/tools/helpers';
import {radius, spacing, tints, type, useTheme} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Viewer'>;

/**
 * Pinch, pan and double tap over one picture: a PDF page opened on its own, or an
 * image. One copy of the gesture code, so the two behave exactly alike.
 *
 * Zoom runs from 1x to 6x. The picture can be dragged by however much of it hangs
 * outside the frame at the current zoom and no further, and double tap toggles
 * between 3x and fitting the frame.
 */
function Zoomable({width, height, children}: {width: number; height: number; children: React.ReactNode}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const clamp = (value: number, limit: number) => {
    'worklet';
    return Math.min(limit, Math.max(-limit, value));
  };

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(6, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) reset();
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate(e => {
      if (scale.value <= 1) return;
      x.value = clamp(savedX.value + e.translationX, ((scale.value - 1) * width) / 2);
      y.value = clamp(savedY.value + e.translationY, ((scale.value - 1) * height) / 2);
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.01) {
        reset();
      } else {
        scale.value = withTiming(3);
        savedScale.value = 3;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({
    transform: [{translateX: x.value}, {translateY: y.value}, {scale: scale.value}],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.zoomStage, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

/** One page of a PDF, drawn natively and only once it is needed. */
function PdfPage({uri, index, width, password}: {uri: string; index: number; width: number; password: string}) {
  const t = useTheme();
  const [src, setSrc] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    FileBridge.renderPdfPage(uri, index, Math.round(width * 2), password)
      .then(page => {
        if (!alive) return;
        setSrc(`data:image/png;base64,${page.base64}`);
        setRatio(page.height / page.width);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [uri, index, width, password]);

  if (failed || !src) {
    return (
      <View style={[styles.pageFallback, {width, height: width * ratio, backgroundColor: t.card, borderColor: t.border}]}>
        {failed ? <Text style={[type.caption, {color: t.textMuted}]}>Page {index + 1} could not be drawn.</Text> : <ActivityIndicator color={t.textMuted} />}
      </View>
    );
  }
  return <Image source={{uri: src}} style={[styles.page, {width, height: width * ratio}]} resizeMode="contain" />;
}

/**
 * One page on its own, where it can be pinched about. A page in the list cannot:
 * it sits inside the screen's vertical scroll, and a pinch there is a fight
 * between the two about whose gesture it is. The page is drawn again at three
 * times the screen width so zooming in shows detail rather than a bigger blur.
 */
function PageZoom({uri, index, pageCount, password, onClose}: {uri: string; index: number; pageCount: number; password: string; onClose: () => void}) {
  const {width, height} = useWindowDimensions();
  const [src, setSrc] = useState<string | null>(null);
  const [ratio, setRatio] = useState(1.414);

  useEffect(() => {
    let alive = true;
    FileBridge.renderPdfPage(uri, index, Math.round(width * 3), password)
      .then(page => {
        if (!alive) return;
        setSrc(`data:image/png;base64,${page.base64}`);
        setRatio(page.height / page.width);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri, index, width, password]);

  const shown = {width, height: Math.min(height, width * ratio)};
  return (
    <ZoomModal label={`Page ${index + 1} of ${pageCount}`} onClose={onClose}>
      <Zoomable width={shown.width} height={shown.height}>
        {src ? <Image source={{uri: src}} style={shown} resizeMode="contain" /> : <ActivityIndicator color="#FFFFFF" />}
      </Zoomable>
    </ZoomModal>
  );
}

/** The full-screen dark stage that a zoomed page or picture opens on. */
function ZoomModal({label, onClose, children}: {label: string; onClose: () => void; children: React.ReactNode}) {
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A Modal is its own native window: the app's gesture root does not reach inside it. */}
      <GestureHandlerRootView style={styles.zoomRoot}>
        {children}
        <View style={styles.zoomBar}>
          <Text style={[type.caption, styles.zoomLabel]} numberOfLines={1}>
            {label}
          </Text>
          <PressableScale onPress={onClose} hitSlop={14} style={styles.zoomDone}>
            <Text style={[type.title, {color: '#FFFFFF'}]}>Done</Text>
          </PressableScale>
        </View>
        <Text style={[type.caption, styles.zoomHint]}>Pinch to zoom · double tap to fit</Text>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** A picture, fitted to the space and zoomable in place. */
function ImageView({uri, onFail}: {uri: string; onFail: () => void}) {
  const [box, setBox] = useState<{w: number; h: number} | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setRatio(h / w),
      () => onFail(),
    );
  }, [uri, onFail]);

  let shown = {width: 0, height: 0};
  if (box && ratio) {
    shown = box.w * ratio <= box.h ? {width: box.w, height: box.w * ratio} : {width: box.h / ratio, height: box.h};
  }

  return (
    <View style={styles.imageBox} onLayout={e => setBox({w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}>
      {box && ratio ? (
        <Zoomable width={shown.width} height={shown.height}>
          <Image source={{uri}} style={shown} resizeMode="contain" />
        </Zoomable>
      ) : (
        <SkeletonBlock width="100%" height={240} />
      )}
    </View>
  );
}

const extOf = (name: string) => (name.match(/\.([^.]+)$/)?.[1] ?? '').toUpperCase();

export function ViewerScreen({route, navigation}: Props) {
  const t = useTheme();
  const {width} = useWindowDimensions();
  const {history, recordView} = useApp();
  const [file, setFile] = useState<PickedFile | null>(route.params?.file ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Which sheet of a workbook is on screen; reset for every new file.
  const [sheet, setSheet] = useState(0);
  // The page opened on its own to be zoomed, or null when the list is on screen.
  const [zoomPage, setZoomPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const historyRef = useRef(history);
  historyRef.current = history;

  // Viewing is free: nothing here counts a conversion or shows an ad.
  const load = useCallback(
    async (target: PickedFile, pass = '') => {
      setBusy(true);
      setError(null);
      setSheet(0);
      try {
        setPreview(await buildPreview(target, pass));
        setNeedsPassword(false);
        // Only once it really opened, and not for a file already in Recent files —
        // opening a converted file again should not list it twice.
        if (!historyRef.current.some(h => h.uri === target.uri)) recordView(target).catch(() => {});
      } catch (e) {
        if (isPasswordError(e) || /password|encrypt/i.test((e as Error).message ?? '')) {
          setNeedsPassword(true);
        } else {
          setError((e as Error).message || 'This file could not be opened.');
        }
        setPreview(null);
      } finally {
        setBusy(false);
      }
    },
    [recordView],
  );

  const pick = useCallback(async () => {
    try {
      // Unfiltered on purpose: providers report MIME types inconsistently, and a
      // filtered picker hid files the viewer reads perfectly well.
      const picked = await FileBridge.pickFile(['*/*']);
      setFile(picked);
      setPassword('');
      if (previewKindFor(picked) === 'unsupported') {
        setPreview({kind: 'unsupported'});
        return;
      }
      load(picked);
    } catch (e) {
      if (!isCancelled(e)) setError((e as Error).message);
    }
  }, [load]);

  // Opened with a file: show it. Opened without one (the View File tool): go
  // straight to the picker, which is the only thing there is to do.
  const incoming = route.params?.file;
  useEffect(() => {
    if (incoming) {
      setFile(incoming);
      load(incoming);
    } else {
      pick();
    }
    // Only when a different file arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.uri]);

  const pageWidth = width - spacing.lg * 2;
  const fills = preview?.kind === 'html' || preview?.kind === 'sheet' || preview?.kind === 'image';

  const body = () => {
    if (busy) {
      return (
        <Animated.View entering={FadeIn.duration(200)} style={styles.centre}>
          <ActivityIndicator color={t.info} size="large" />
          <Text style={[type.caption, {color: t.textMuted, marginTop: spacing.md}]}>Opening…</Text>
        </Animated.View>
      );
    }

    if (needsPassword) {
      return (
        <Animated.View entering={enter(0)}>
          <Card>
            <View style={styles.cardHead}>
              <GradientTile tint="yellow" icon="lock" size={44} />
              <Text style={[type.h2, {color: t.text, flex: 1, marginLeft: spacing.md}]}>
                {file && previewKindFor(file) === 'archive' ? 'This archive needs a password' : 'This file needs a password'}
              </Text>
            </View>
            <Field label="Password" value={password} onChangeText={setPassword} secure />
            <GradientButton label="Open it" icon="unlock" tint="yellow" onPress={() => file && load(file, password)} disabled={!password} style={{marginTop: spacing.md}} />
          </Card>
        </Animated.View>
      );
    }

    if (error) {
      return (
        <Animated.View entering={enter(0)}>
          <Card style={styles.cardHead}>
            <Icon name="alert" color={t.negative} size={22} />
            <View style={{flex: 1, marginLeft: spacing.md}}>
              <Text style={[type.title, {color: t.text}]}>That did not work</Text>
              <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>{error}</Text>
            </View>
          </Card>
        </Animated.View>
      );
    }

    if (!file || !preview) {
      return (
        <Animated.View entering={enter(0)}>
          <PressableScale onPress={pick} style={[styles.drop, {borderColor: t.borderStrong, backgroundColor: t.card}]}>
            <View style={[styles.dropIcon, {backgroundColor: t.infoSoft}]}>
              <Icon name="eye" color={t.info} size={28} />
            </View>
            <Text style={[type.title, {color: t.text, marginTop: spacing.md}]}>Choose a file</Text>
            <Text style={[type.caption, {color: t.textMuted, marginTop: 4, textAlign: 'center'}]}>
              PDF, Word, Excel, CSV, slides, text, images and archives.
            </Text>
          </PressableScale>
        </Animated.View>
      );
    }

    if (preview.kind === 'unsupported') {
      return (
        <Animated.View entering={enter(0)}>
          <Card>
            <Text style={[type.title, {color: t.text}]}>Not a format the viewer opens</Text>
            <Text style={[type.caption, {color: t.textMuted, marginTop: 6, lineHeight: 18}]}>
              {file.name} is not one of the formats this app can show. Another app on the phone may open it.
            </Text>
            <GhostButton label="Open in another app" icon="open" onPress={() => FileBridge.openFile(file.uri, file.mime || '*/*').catch(() => {})} style={{marginTop: spacing.md}} />
          </Card>
        </Animated.View>
      );
    }

    if (preview.kind === 'image') {
      return <ImageView uri={file.uri} onFail={() => setError('This picture could not be decoded on this phone.')} />;
    }

    if (preview.kind === 'pdf') {
      return (
        <View>
          <Text style={[type.caption, {color: t.textMuted, textAlign: 'center', marginBottom: spacing.sm}]}>Tap a page to zoom in</Text>
          {Array.from({length: preview.pageCount}, (_, i) => (
            <Animated.View key={i} entering={enter(i, 50)}>
              <PressableScale onPress={() => setZoomPage(i)} scaleTo={0.98} style={{marginBottom: spacing.lg}}>
                <Text style={[type.caption, {color: t.textDim, marginBottom: 6}]}>
                  Page {i + 1} of {preview.pageCount}
                </Text>
                <PdfPage uri={file.uri} index={i} width={pageWidth} password={password} />
              </PressableScale>
            </Animated.View>
          ))}
          {zoomPage !== null ? (
            <PageZoom uri={file.uri} index={zoomPage} pageCount={preview.pageCount} password={password} onClose={() => setZoomPage(null)} />
          ) : null}
        </View>
      );
    }

    if (preview.kind === 'archive') {
      return (
        <View>
          <Text style={[type.caption, {color: t.textMuted, marginBottom: spacing.md, lineHeight: 18}]}>
            {preview.entries.length} {preview.entries.length === 1 ? 'file' : 'files'} inside, still packed. Extracting saves them into Downloads.
          </Text>
          {/* The File Extractor's own screen, so the free allowance is counted the way it always is. */}
          <GradientButton label="Extract all files" icon="unzip" tint="yellow" onPress={() => navigation.navigate('Tool', {toolId: 'extract-archive', files: [file]})} style={{marginBottom: spacing.md}} />
          {preview.entries.map((entry, i) => (
            <Animated.View key={`${entry.name}-${i}`} entering={enter(i, 30)}>
              <Card style={styles.entry}>
                <View style={[styles.extBadge, {backgroundColor: t.cardAlt}]}>
                  <Text style={[type.caption, {color: t.textMuted, fontWeight: '700'}]} numberOfLines={1}>
                    {extOf(entry.name) || '?'}
                  </Text>
                </View>
                <View style={{flex: 1, marginLeft: spacing.md}}>
                  <Text style={[type.body, {color: t.text}]} numberOfLines={2}>
                    {entry.name}
                  </Text>
                  {entry.size >= 0 ? <Text style={[type.caption, {color: t.textMuted, marginTop: 2}]}>{humanBytes(entry.size)}</Text> : null}
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      );
    }

    if (preview.kind === 'sheet') {
      const active = preview.sheets[Math.min(sheet, preview.sheets.length - 1)];
      const [, green] = tints.green;
      return (
        <View style={[styles.webWrap, {borderColor: t.border}]}>
          <WebView
            key={active.name}
            originWhitelist={['*']}
            source={{html: active.html}}
            style={styles.web}
            javaScriptEnabled={false}
            // Pinch to zoom, so a wide sheet can be pulled back far enough to read.
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={req => req.url === 'about:blank' || req.url.startsWith('data:')}
          />
          {preview.sheets.length > 1 ? (
            // Drawn by the app, not the page, so the tabs keep their size when the sheet is pinched.
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabs, {backgroundColor: t.cardAlt, borderTopColor: t.border}]} contentContainerStyle={styles.tabsRow}>
              {preview.sheets.map((sh, i) => {
                const on = i === sheet;
                return (
                  <Pressable key={sh.name} onPress={() => setSheet(i)} style={[styles.tab, {borderRightColor: t.border, borderTopColor: on ? green : 'transparent', backgroundColor: on ? t.card : 'transparent'}]}>
                    <Text style={[type.title, {color: on ? green : t.textMuted, maxWidth: 200}]} numberOfLines={1}>
                      {sh.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      );
    }

    // Word, slides, text and HTML: inert, script-free pages that cannot reach the network.
    return (
      <View style={[styles.webWrap, {borderColor: t.border}]}>
        <WebView
          originWhitelist={['*']}
          source={{html: preview.html}}
          style={styles.web}
          javaScriptEnabled={false}
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={req => req.url === 'about:blank' || req.url.startsWith('data:')}
        />
      </View>
    );
  };

  const note = preview && preview.kind === 'html' ? preview.note : undefined;
  const change = file ? (
    // An icon, not the word: the header's right slot is a fixed-width button and
    // "Change" wrapped onto two lines beside a long file name.
    <PressableScale onPress={pick} hitSlop={10} style={styles.change} accessibilityLabel="Choose a different file">
      <Icon name="folder" color={t.info} size={22} />
    </PressableScale>
  ) : undefined;

  return (
    <Screen bottom>
      <ScreenHeader title={file ? file.name : 'View File'} subtitle={file ? humanBytes(file.size) : 'Read it without converting it'} onBack={navigation.goBack} right={change} />
      {note ? <Text style={[type.caption, styles.note, {color: t.textMuted}]}>{note}</Text> : null}
      {fills ? (
        <View style={styles.fill}>{body()}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {body()}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 40},
  fill: {flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.md},
  centre: {alignItems: 'center', paddingVertical: spacing.xxl},
  note: {paddingHorizontal: spacing.lg, marginBottom: spacing.sm},
  change: {paddingHorizontal: 4, paddingVertical: 4},
  cardHead: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm},
  drop: {borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.lg, alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg},
  dropIcon: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
  page: {borderRadius: radius.sm, backgroundColor: '#FFFFFF'},
  pageFallback: {borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center'},
  entry: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, marginBottom: spacing.sm},
  extBadge: {width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  // The page itself stays white in both themes: it is the document, not the app.
  webWrap: {flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth},
  web: {flex: 1, backgroundColor: '#FFFFFF'},
  // Explicit height and no shrinking: beside a flex:1 WebView, a self-sizing ScrollView was squeezed to nothing.
  tabs: {height: 47, flexGrow: 0, flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth},
  tabsRow: {alignItems: 'stretch'},
  tab: {height: 46, justifyContent: 'center', paddingHorizontal: 20, borderRightWidth: StyleSheet.hairlineWidth, borderTopWidth: 3},
  imageBox: {flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: radius.lg},
  zoomStage: {alignItems: 'center', justifyContent: 'center'},
  zoomRoot: {flex: 1, backgroundColor: '#0B0B12', alignItems: 'center', justifyContent: 'center'},
  // Backed, so the controls stay readable when a zoomed white page fills the screen behind them.
  zoomBar: {position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: 48, paddingBottom: spacing.md, backgroundColor: 'rgba(11,11,18,0.78)'},
  zoomLabel: {color: 'rgba(255,255,255,0.8)', flex: 1},
  zoomDone: {paddingHorizontal: 6, paddingVertical: 4},
  zoomHint: {position: 'absolute', bottom: 40, color: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(11,11,18,0.7)', borderRadius: radius.pill, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 6},
});
