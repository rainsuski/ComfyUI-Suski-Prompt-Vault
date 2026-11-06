/* File: ComfyUI-Suski-Prompt-Vault/web/js/utils/share_codec.js */

/**
 * 纯离线无依赖的词库分享代码编解码器。
 * 采用现代浏览器原生 CompressionStream('deflate-raw') 流式压缩，
 * 压缩率通常在 70% ~ 80% 之间，并转换为可安全在聊天软件/跨平台传播的 Base64 格式。
 */

export const SHARE_CODE_PREFIX = "SUSKI-SHARE-v1:";

/**
 * 将 Uint8Array 转换为二进制字符串并进行 Base64 编码
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ArrayToBase64(bytes) {
    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
}

/**
 * 将 Base64 字符串解码还原为 Uint8Array
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * 压缩数据并生成分享短代码。
 * @param {any} dataObject 待分享的对象数据
 * @returns {Promise<string>} 格式为 `SUSKI-SHARE-v1:<base64>` 的分享代码
 */
export async function encodeSharePayload(dataObject) {
    const jsonString = JSON.stringify(dataObject);
    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(jsonString);

    if (typeof CompressionStream !== "undefined") {
        try {
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(rawBytes);
                    controller.close();
                },
            });
            const compressedStream = stream.pipeThrough(new CompressionStream("deflate-raw"));
            const reader = compressedStream.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
            const merged = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                merged.set(chunk, offset);
                offset += chunk.byteLength;
            }
            const b64 = uint8ArrayToBase64(merged);
            return `${SHARE_CODE_PREFIX}${b64}`;
        } catch (err) {
            console.warn("[PromptVault] CompressionStream failed, fallback to raw base64:", err);
        }
    }

    // 极端环境降级为普通 UTF-8 Base64
    const b64 = uint8ArrayToBase64(rawBytes);
    return `${SHARE_CODE_PREFIX}RAW:${b64}`;
}

/**
 * 解码并还原分享代码为数据对象。
 * @param {string} shareCode 粘贴的分享代码
 * @returns {Promise<any>} 解析后的数据对象
 */
export async function decodeSharePayload(shareCode) {
    if (!shareCode || typeof shareCode !== "string") {
        throw new Error("分享代码不能为空");
    }

    const trimmed = shareCode.trim();
    if (!trimmed.startsWith(SHARE_CODE_PREFIX)) {
        throw new Error("不是合法的 Suski Prompt Vault 分享代码（缺少版本头标识）");
    }

    const payload = trimmed.slice(SHARE_CODE_PREFIX.length).trim();

    if (payload.startsWith("RAW:")) {
        const rawB64 = payload.slice(4);
        const bytes = base64ToUint8Array(rawB64);
        const decoder = new TextDecoder("utf-8");
        return JSON.parse(decoder.decode(bytes));
    }

    const compressedBytes = base64ToUint8Array(payload);

    if (typeof DecompressionStream !== "undefined") {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(compressedBytes);
                controller.close();
            },
        });
        const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
        const reader = decompressedStream.getReader();
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const decoder = new TextDecoder("utf-8");
        return JSON.parse(decoder.decode(merged));
    }

    throw new Error("当前浏览器环境不支持 DecompressionStream，无法解压分享代码");
}