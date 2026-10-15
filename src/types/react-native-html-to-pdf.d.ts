/**
 * react-native-html-to-pdf ships no types. Only the part the converter uses is
 * declared, so a wrong option name is still caught rather than silently accepted
 * as `any`.
 */
declare module 'react-native-html-to-pdf' {
  export type HtmlToPdfOptions = {
    html: string;
    fileName?: string;
    directory?: string;
    base64?: boolean;
    padding?: number;
    width?: number;
    height?: number;
    bgColor?: string;
  };

  export type HtmlToPdfResult = {
    filePath?: string;
    base64?: string;
  };

  const RNHTMLtoPDF: {
    convert(options: HtmlToPdfOptions): Promise<HtmlToPdfResult | undefined>;
  };

  export default RNHTMLtoPDF;
}
