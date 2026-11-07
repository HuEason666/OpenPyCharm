/**
 * 智能体工具窗口：OpenAI 兼容接口的聊天面板。
 * 支持附加当前文件作为上下文；回复中的代码块可一键复制。
 * 接口配置在 设置 › 智能体（API 地址 / API Key / 模型）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../ui/icons";
import { ipc } from "../../platform/ipc";
import { useSettings } from "../../platform/settings";
import { useDocs } from "../../editor/docs";
import styles from "./AgentView.module.css";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  images?: string[]; // data URL，仅用户消息
}

/** OpenAI 视觉格式：用户消息的 content 可为分段数组。 */
type ApiContent =
  | string
  | Array<{ type: string; text?: string; image_url?: { url: string } }>;

/** Split assistant text into prose / fenced-code segments. */
function segments(text: string): Array<{ type: "text" | "code"; body: string }> {
  const out: Array<{ type: "text" | "code"; body: string }> = [];
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", body: text.slice(last, m.index) });
    out.push({ type: "code", body: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", body: text.slice(last) });
  return out;
}

const MAX_FILE_CONTEXT = 8000;
const MAX_IMAGES = 4;

export function AgentView() {
  const settings = useSettings((s) => s.settings);
  const endpoint = settings.aiEndpoint ?? "https://api.openai.com/v1";
  const apiKey = settings.aiApiKey ?? "";
  const model = settings.aiModel ?? "gpt-4o-mini";

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachFile, setAttachFile] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [imgError, setImgError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeDocName = useDocs((s) => s.docs.find((d) => d.id === s.activeId)?.name ?? null);
  const configured = apiKey.trim().length > 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // 选择本地图片，转为 data URL 附在输入区。
  const pickImage = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({
      multiple: true,
      title: "附加图片",
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
    });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    setImgError(null);
    try {
      const urls: string[] = [];
      for (const p of paths) urls.push(await ipc.aiImageDataUrl(p));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch (e) {
      setImgError(String(e));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (busy || (!text && images.length === 0)) return;
    setInput("");
    const imgs = images.length ? [...images] : undefined;
    setImages([]);
    setImgError(null);
    const outgoing: ChatMsg[] = [...messages, { role: "user" as const, content: text, images: imgs }];
    setMessages([...outgoing]);
    setBusy(true);
    try {
      const apiMessages: Array<{ role: string; content: ApiContent }> = [];
      if (attachFile) {
        const docs = useDocs.getState();
        const id = docs.activeId;
        const viewText = docs.docs.find((d) => d.id === id)?.saved ?? "";
        if (id && viewText) {
          apiMessages.push({
            role: "system",
            content: `以下是用户当前打开的文件 ${id} 的内容：\n\n${viewText.slice(0, MAX_FILE_CONTEXT)}`,
          });
        }
      }
      for (const m of outgoing) {
        if (m.role === "user" && m.images?.length) {
          // 带图片的消息走 OpenAI 视觉格式的分段 content。
          apiMessages.push({
            role: "user",
            content: [
              { type: "text", text: m.content },
              ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          });
        } else {
          apiMessages.push({ role: m.role, content: m.content });
        }
      }
      const reply = await ipc.aiChat(endpoint, apiKey, model, apiMessages);
      setMessages([...outgoing, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...outgoing, { role: "assistant", content: String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const body = useMemo(() => {
    if (!configured) {
      return (
        <div className={styles.empty}>
          <span className={styles.icon}>
            <Icon name="toolwindow-agents" size={28} />
          </span>
          <div>智能体未配置</div>
          <div className={styles.configHint}>
            在 设置 › 智能体 中填写 OpenAI 兼容接口的 API 地址、Key 与模型名（支持 DeepSeek、Kimi、通义、本地
            Ollama 等）。
          </div>
        </div>
      );
    }
    return (
      <div className={styles.messages} ref={listRef}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.icon}>
              <Icon name="toolwindow-agents" size={26} />
            </span>
            <div>向智能体提问，让它帮你写代码、解释报错、生成测试…</div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.msgUser : ""}`}>
            <span className={styles.msgRole}>{m.role === "user" ? "我" : "智能体"}</span>
            {m.error ? (
              <span className={styles.errorText}>{m.content}</span>
            ) : m.role === "assistant" ? (
              segments(m.content).map((seg, j) =>
                seg.type === "code" ? (
                  <div key={j} className={styles.codeBlock}>
                    <button
                      type="button"
                      className={styles.copyBtn}
                      onClick={() => void navigator.clipboard.writeText(seg.body)}
                    >
                      复制
                    </button>
                    <pre>{seg.body}</pre>
                  </div>
                ) : (
                  <span key={j}>{seg.body}</span>
                ),
              )
            ) : (
              <>
                {m.images?.length ? (
                  <div className={styles.msgImages}>
                    {m.images.map((url, j) => (
                      <img key={j} src={url} alt="" className={styles.msgImage} />
                    ))}
                  </div>
                ) : null}
                {m.content ? <span>{m.content}</span> : null}
              </>
            )}
          </div>
        ))}
        {busy ? <div className={styles.pending}>智能体思考中…</div> : null}
      </div>
    );
  }, [messages, busy, configured]);

  return (
    <div className={styles.agent}>
      {body}
      <div className={styles.inputRow}>
        <div className={styles.attachRow}>
          <label>
            <input type="checkbox" checked={attachFile} onChange={(e) => setAttachFile(e.target.checked)} />
            附加当前文件{activeDocName ? `（${activeDocName}）` : ""}
          </label>
          <button
            type="button"
            className={styles.imgBtn}
            disabled={!configured || images.length >= MAX_IMAGES}
            onClick={() => void pickImage()}
            title={`附加图片（最多 ${MAX_IMAGES} 张，随下一条消息发送）`}
          >
            <Icon name="file-image" size={13} />
            图片
          </button>
          <span className={styles.model}>{configured ? model : "未配置"}</span>
        </div>
        {imgError ? <div className={styles.imgError}>{imgError}</div> : null}
        {images.length ? (
          <div className={styles.thumbRow}>
            {images.map((url, i) => (
              <div key={i} className={styles.thumb}>
                <img src={url} alt="" />
                <button
                  type="button"
                  className={styles.thumbRemove}
                  title="移除"
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className={styles.input}
          value={input}
          placeholder={configured ? "输入问题…（Ctrl+Enter 发送，可先点「图片」附加截图）" : "先在设置 › 智能体 中配置 API Key"}
          disabled={!configured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className={styles.sendRow}>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            disabled={!configured || busy || (!input.trim() && images.length === 0)}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
