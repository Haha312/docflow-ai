
/**
 * Smart Chunking Utility
 * 鐢ㄤ簬灏嗛暱鏂囨。璇箟鍖栧垏鍒嗕负閫傚悎 LLM 澶勭悊鐨勭墖娈?
 */

export interface Chunk {
    index: number;
    total: number;
    content: string;
    startIndex: number;
    endIndex: number;
}

/**
 * 浼扮畻 Token 鏁伴噺 (绠€鍗曟寜瀛楃鏁颁及绠? 涓枃 1 char 鈮?1-2 tokens)
 * Gemini 3 Pro Preview 鏀寔澶т笂涓嬫枃绐楀彛鍜?16k output銆?
 * 12000 瀛楃杈撳叆 -> 绾?18000 杈撳嚭瀛楃 -> 绾?12000-14000 tokens銆?
 * 鏇村ぇ鐨勫潡 = 鏇村皯鐨?API 璋冪敤 = 鏇村揩鐨勯€熷害锛屽悓鏃朵繚鎸佸湪妯″瀷杈撳嚭闄愬埗鍐呫€?
 */
const CHUNK_SIZE_CHARS = 12000;

// 瀹為檯涓婃垜浠笉闇€瑕佺墿鐞嗛噸鍙?content (杩欎細瀵艰嚧閲嶅杈撳嚭)锛?
// 鎴戜滑闇€瑕佺殑鏄皢涓婁竴娈电殑鏈熬浣滀负 Context 浼犵粰 AI銆?

export const splitContentBySemantics = (content: string, maxChars: number = CHUNK_SIZE_CHARS): string[] => {
    if (content.length <= maxChars) {
        return [content];
    }

    const chunks: string[] = [];
    let processed = 0;

    while (processed < content.length) {
        // 鍓╀綑鍐呭鏄惁瓒冲灏?
        if (content.length - processed <= maxChars) {
            chunks.push(content.slice(processed));
            break;
        }

        // 瀵绘壘鏈€浣冲垏鍒嗙偣
        let splitIndex = processed + maxChars;

        // 鍚戝墠鎼滅储鏈€杩戠殑娈佃惤缁撴潫绗?(\n\n)
        // 鎼滅储鑼冨洿锛歴plitIndex 寰€鍓?1000 瀛楃
        const searchWindow = content.slice(Math.max(processed, splitIndex - 1000), splitIndex);

        // 浼樺厛绾?1: 鍙屾崲琛?(娈佃惤)
        const lastDoubleLine = searchWindow.lastIndexOf('\n\n');
        // 浼樺厛绾?2: 鍗曟崲琛?
        const lastSingleLine = searchWindow.lastIndexOf('\n');
        // 浼樺厛绾?3: 鍙ュ瓙缁撴潫绗?(銆傦紒锛?
        const lastSentenceEnd = Math.max(
            searchWindow.lastIndexOf('。'),
            searchWindow.lastIndexOf('！'),
            searchWindow.lastIndexOf('？')
        );

        let cutPointRel = -1;

        if (lastDoubleLine !== -1) {
            cutPointRel = lastDoubleLine + 2; // 鍖呮嫭鎹㈣绗?
        } else if (lastSingleLine !== -1) {
            cutPointRel = lastSingleLine + 1;
        } else if (lastSentenceEnd !== -1) {
            cutPointRel = lastSentenceEnd + 1; // 鍖呮嫭鏍囩偣
        }

        if (cutPointRel !== -1) {
            // 鎵惧埌浜嗚涔夊垏鍒嗙偣
            // searchWindow 鐨勮捣濮嬩綅缃槸 Math.max(processed, splitIndex - 1000)
            const windowStart = Math.max(processed, splitIndex - 1000);
            splitIndex = windowStart + cutPointRel;
        } else {
            // 瀹炲湪鎵句笉鍒帮紙姣斿瓒呴暱鐨勪竴娈垫棤鏍囩偣鏂囨湰锛夛紝寮哄埗鍒囧垎
            // 淇濇寔 splitIndex = processed + maxChars
        }

        chunks.push(content.slice(processed, splitIndex));
        processed = splitIndex;
    }

    return chunks;
};
