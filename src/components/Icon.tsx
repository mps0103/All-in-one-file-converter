import React from 'react';
import {View} from 'react-native';
import Svg, {Circle, Path, Rect} from 'react-native-svg';

export type IconName =
  | 'home'
  | 'files'
  | 'crown'
  | 'settings'
  | 'search'
  | 'back'
  | 'chevron'
  | 'close'
  | 'check'
  | 'pdf'
  | 'doc'
  | 'merge'
  | 'split'
  | 'compress'
  | 'image'
  | 'images'
  | 'rotate'
  | 'word'
  | 'excel'
  | 'slides'
  | 'text'
  | 'lock'
  | 'unlock'
  | 'music'
  | 'video'
  | 'scissors'
  | 'layers'
  | 'volume'
  | 'mute'
  | 'wave'
  | 'bell'
  | 'zip'
  | 'unzip'
  | 'info'
  | 'drop'
  | 'scan'
  | 'resize'
  | 'crop'
  | 'flip'
  | 'convert'
  | 'grid'
  | 'gauge'
  | 'monitor'
  | 'fade'
  | 'download'
  | 'share'
  | 'open'
  | 'trash'
  | 'folder'
  | 'sparkle'
  | 'star'
  | 'shield'
  | 'sun'
  | 'moon'
  | 'phone'
  | 'plus'
  | 'upload'
  | 'clock'
  | 'refresh'
  | 'hash'
  | 'pages'
  | 'gray'
  | 'mail'
  | 'alert'
  | 'film'
  | 'extract'
  | 'restore'
  | 'policy'
  | 'cache'
  | 'eye'
  | 'camera'
  | 'play'
  | 'pause';

type Props = {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
};

/** One stroke icon set for the whole app — no icon font to link, crisp at any size. */
export function Icon({name, size = 22, color, strokeWidth = 1.9}: Props) {
  const p = {
    stroke: color,
    strokeWidth,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const sheet = 'M7 3h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V4.5A1.5 1.5 0 0 1 7.5 3Z';
  const fold = 'M14 3v5h5';

  const body = (() => {
    switch (name) {
      case 'home':
        return <Path {...p} d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5" />;
      case 'files':
        return (
          <>
            <Path {...p} d="M8 7V4.5A1.5 1.5 0 0 1 9.5 3H15l4 4v10.5a1.5 1.5 0 0 1-1.5 1.5H16" />
            <Path {...p} d="M5.5 7H11l3 3v9.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7Z" />
          </>
        );
      case 'crown':
        return <Path {...p} d="M4 8l4 4 4-7 4 7 4-4-1.5 10h-13L4 8ZM5.5 21h13" />;
      case 'settings':
        return (
          <>
            <Circle {...p} cx={12} cy={12} r={3} />
            <Path
              {...p}
              d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
            />
          </>
        );
      case 'search':
        return (
          <>
            <Circle {...p} cx={11} cy={11} r={6.5} />
            <Path {...p} d="m20 20-4.2-4.2" />
          </>
        );
      case 'back':
        return <Path {...p} d="M15 5l-7 7 7 7" />;
      case 'chevron':
        return <Path {...p} d="M9 5l7 7-7 7" />;
      case 'close':
        return <Path {...p} d="M6 6l12 12M18 6 6 18" />;
      case 'check':
        return <Path {...p} d="M5 12.5l4.5 4.5L19 7.5" />;
      case 'pdf':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d={fold} />
            <Path {...p} d="M9 17v-4h1.5a1.3 1.3 0 0 1 0 2.6H9M13.5 17v-4h1a2 2 0 0 1 0 4h-1Z" />
          </>
        );
      case 'doc':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d={fold} />
            <Path {...p} d="M9 12.5h6M9 15.5h6M9 9.5h2.5" />
          </>
        );
      case 'merge':
        return <Path {...p} d="M6 4v5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v5M18 4v5a3 3 0 0 1-3 3M15 17l3 3 3-3" />;
      case 'split':
        return <Path {...p} d="M12 3v7M12 10l-6 6v4M12 10l6 6v4M3 17l3-3 3 3M15 17l3-3 3 3" />;
      case 'compress':
        return <Path {...p} d="M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5M20 4l-6 6M19 10h-5V5M4 20l6-6M5 14h5v5" />;
      case 'image':
        return (
          <>
            <Rect {...p} x={3.5} y={4.5} width={17} height={15} rx={2} />
            <Circle {...p} cx={9} cy={10} r={1.7} />
            <Path {...p} d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
          </>
        );
      case 'images':
        return (
          <>
            <Rect {...p} x={6.5} y={3.5} width={14} height={12} rx={2} />
            <Path {...p} d="M3.5 8v10a2.5 2.5 0 0 0 2.5 2.5h11" />
            <Path {...p} d="m7 13.5 4-3.5 3 2.5 2.5-2 4 3.5" />
          </>
        );
      case 'rotate':
        return <Path {...p} d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />;
      case 'word':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d={fold} />
            <Path {...p} d="m8.5 11 1.3 6 2.2-4.5 2.2 4.5 1.3-6" />
          </>
        );
      case 'excel':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d={fold} />
            <Path {...p} d="m9 11.5 5 5.5M14 11.5 9 17" />
          </>
        );
      case 'slides':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d={fold} />
            <Path {...p} d="M10 17v-5.5h2.2a1.6 1.6 0 0 1 0 3.2H10" />
          </>
        );
      case 'text':
        return <Path {...p} d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />;
      case 'lock':
        return (
          <>
            <Rect {...p} x={5} y={10.5} width={14} height={10} rx={2} />
            <Path {...p} d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
          </>
        );
      case 'unlock':
        return (
          <>
            <Rect {...p} x={5} y={10.5} width={14} height={10} rx={2} />
            <Path {...p} d="M8 10.5V8a4 4 0 0 1 7.6-1.7M12 14.5v2.5" />
          </>
        );
      case 'music':
        return (
          <>
            <Path {...p} d="M9 18V5.5l11-2V16" />
            <Circle {...p} cx={6.5} cy={18} r={2.5} />
            <Circle {...p} cx={17.5} cy={16} r={2.5} />
          </>
        );
      case 'video':
        return (
          <>
            <Rect {...p} x={3} y={6} width={13} height={12} rx={2} />
            <Path {...p} d="m16 10.5 5-3v9l-5-3" />
          </>
        );
      case 'film':
        return (
          <>
            <Rect {...p} x={3.5} y={3.5} width={17} height={17} rx={2} />
            <Path {...p} d="M8 3.5v17M16 3.5v17M3.5 8H8M3.5 12H8M3.5 16H8M16 8h4.5M16 12h4.5M16 16h4.5" />
          </>
        );
      case 'scissors':
        return (
          <>
            <Circle {...p} cx={6} cy={6.5} r={2.5} />
            <Circle {...p} cx={6} cy={17.5} r={2.5} />
            <Path {...p} d="M8.2 8 20 18M8.2 16 20 6" />
          </>
        );
      case 'layers':
        return <Path {...p} d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5" />;
      case 'volume':
        return <Path {...p} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />;
      case 'mute':
        return <Path {...p} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5ZM16 9.5l5 5M21 9.5l-5 5" />;
      case 'wave':
        return <Path {...p} d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />;
      case 'bell':
        return <Path {...p} d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0" />;
      case 'zip':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d="M11 3v2h1.5v2H11v2h1.5v2H11v2" />
            <Rect {...p} x={10} y={14} width={3.5} height={4} rx={1} />
          </>
        );
      case 'unzip':
      case 'extract':
        return (
          <>
            <Path {...p} d="M4 8.5 6.5 4h11L20 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V8.5ZM4 8.5h16" />
            <Path {...p} d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
          </>
        );
      case 'info':
        return (
          <>
            <Circle {...p} cx={12} cy={12} r={9} />
            <Path {...p} d="M12 11v5.5M12 7.7v.1" />
          </>
        );
      case 'alert':
        return (
          <>
            <Path {...p} d="M12 3.5 21.5 20h-19L12 3.5Z" />
            <Path {...p} d="M12 10v4.5M12 17.4v.1" />
          </>
        );
      case 'drop':
        return <Path {...p} d="M12 3.5s6.5 7 6.5 11a6.5 6.5 0 0 1-13 0c0-4 6.5-11 6.5-11Z" />;
      case 'scan':
        return <Path {...p} d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 9h8M8 12h8M8 15h5" />;
      case 'resize':
        return <Path {...p} d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />;
      case 'crop':
        return <Path {...p} d="M6 2.5V17a1 1 0 0 0 1 1h14.5M2.5 6H17a1 1 0 0 1 1 1v14.5" />;
      case 'flip':
        return <Path {...p} d="M12 3v18M9 6.5 4 17h5V6.5ZM15 6.5 20 17h-5V6.5Z" />;
      case 'convert':
        return <Path {...p} d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />;
      case 'refresh':
        return <Path {...p} d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5M4 12.5a8 8 0 0 0 13.7 5.2l2.3-2.2M20 20v-4.5h-4.5" />;
      case 'grid':
        return (
          <>
            <Rect {...p} x={4} y={4} width={7} height={7} rx={2} />
            <Rect {...p} x={13} y={4} width={7} height={7} rx={2} />
            <Rect {...p} x={4} y={13} width={7} height={7} rx={2} />
            <Rect {...p} x={13} y={13} width={7} height={7} rx={2} />
          </>
        );
      case 'gauge':
        return <Path {...p} d="M4 17a8 8 0 1 1 16 0M12 17l4-5.5M12 17v.1" />;
      case 'monitor':
        return (
          <>
            <Rect {...p} x={3} y={4.5} width={18} height={12} rx={2} />
            <Path {...p} d="M8.5 20h7M12 16.5V20" />
          </>
        );
      case 'fade':
        return <Path {...p} d="M3 19 10 6l4 7 3-4 4 10H3Z" />;
      case 'download':
        return <Path {...p} d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />;
      case 'upload':
        return <Path {...p} d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" />;
      case 'share':
        return (
          <>
            <Circle {...p} cx={18} cy={5.5} r={2.5} />
            <Circle {...p} cx={6} cy={12} r={2.5} />
            <Circle {...p} cx={18} cy={18.5} r={2.5} />
            <Path {...p} d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" />
          </>
        );
      case 'open':
        return <Path {...p} d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />;
      case 'trash':
        return <Path {...p} d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />;
      case 'folder':
        return <Path {...p} d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-12Z" />;
      case 'sparkle':
        return <Path {...p} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />;
      case 'star':
        return <Path {...p} d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />;
      case 'shield':
        return <Path {...p} d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6l-7-3ZM9 12l2 2 4-4" />;
      case 'policy':
        return (
          <>
            <Path {...p} d={sheet} />
            <Path {...p} d="m9.5 14 1.8 1.8 3.5-3.5" />
          </>
        );
      case 'sun':
        return (
          <>
            <Circle {...p} cx={12} cy={12} r={4} />
            <Path {...p} d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </>
        );
      case 'moon':
        return <Path {...p} d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />;
      case 'phone':
        return (
          <>
            <Rect {...p} x={6.5} y={2.5} width={11} height={19} rx={2.5} />
            <Path {...p} d="M11 18.5h2" />
          </>
        );
      case 'plus':
        return <Path {...p} d="M12 5v14M5 12h14" />;
      case 'clock':
        return (
          <>
            <Circle {...p} cx={12} cy={12} r={8.5} />
            <Path {...p} d="M12 7.5V12l3 2" />
          </>
        );
      case 'hash':
        return <Path {...p} d="M9 4 7.5 20M16.5 4 15 20M4.5 9h16M3.5 15h16" />;
      case 'pages':
        return (
          <>
            <Rect {...p} x={4} y={3.5} width={11} height={14} rx={1.5} />
            <Path {...p} d="M9 20.5h9.5a1.5 1.5 0 0 0 1.5-1.5V8" />
          </>
        );
      case 'gray':
        return (
          <>
            <Circle {...p} cx={12} cy={12} r={8.5} />
            <Path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill={color} />
          </>
        );
      case 'mail':
        return (
          <>
            <Rect {...p} x={3.5} y={5.5} width={17} height={13} rx={2} />
            <Path {...p} d="m4 7 8 6 8-6" />
          </>
        );
      case 'restore':
        return <Path {...p} d="M4 12a8 8 0 1 0 2.3-5.6L4 8.5M4 4v4.5h4.5M12 8v4l2.5 2" />;
      case 'cache':
        return <Path {...p} d="M5 6c0-1.4 3.1-2.5 7-2.5S19 4.6 19 6s-3.1 2.5-7 2.5S5 7.4 5 6ZM5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />;
      case 'play':
        return <Path {...p} d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />;
      case 'pause':
        return <Path {...p} d="M8.5 5.5v13M15.5 5.5v13" />;
      case 'camera':
        return (
          <>
            <Path {...p} d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
            <Circle {...p} cx={12} cy={12.5} r={3.4} />
          </>
        );
      case 'eye':
        return (
          <>
            <Path {...p} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <Circle {...p} cx={12} cy={12} r={3} />
          </>
        );
      default:
        return <Circle {...p} cx={12} cy={12} r={8} />;
    }
  })();

  // Wrapped in a View so the icon always stacks above gradient backgrounds drawn before it.
  return (
    <View style={{width: size, height: size}} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {body}
      </Svg>
    </View>
  );
}
