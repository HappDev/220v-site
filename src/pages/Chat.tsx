import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";

import DashboardSidebar from "@/components/DashboardSidebar";
import { useDashboardSidebarItems } from "@/hooks/useDashboardSidebarItems";
import { apiBase } from "@/lib/api";
import {
  buildTalkMeCustomFields,
  buildTalkMeVisitorName,
  ensureTalkMeScript,
  setTalkMeClientInfo,
} from "@/lib/talkme";
import { getVpnTalkmeProfileRaw } from "@/lib/vpnStorage";
import LandingFooter from "@/pages/landing/LandingFooter";
import LandingShell from "@/pages/landing/LandingShell";

type ChatMessage = {
  id: number;
  text: string;
  sender: "client" | "operator";
  operatorName: string | null;
  dateTime: string;
  status: string;
};

type ClientSearchResponse = {
  clients?: Array<{
    clientId?: string;
    searchId?: number | null;
    name?: string;
    email?: string;
  }>;
};

type ClientIdResponse = {
  clientId?: string;
};

type MessagesResponse = {
  messages?: ChatMessage[];
};

type SendResponse = {
  messageId?: number | null;
  clientId?: string;
};

type ChatAttachmentUploadResponse = {
  url?: string;
  path?: string;
  fileName?: string;
};

type DialogStatusResponse = {
  statusLabel?: string | null;
};

type OperatorListResponse = {
  onlineCount?: number;
};

type OperatorTypingResponse = {
  typing?: boolean;
};

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text || "Invalid JSON" };
  }

  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return (parsed ?? {}) as T;
}

async function uploadChatAttachment(file: File): Promise<ChatAttachmentUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${apiBase}/support/chat-attachment`, {
    method: "POST",
    body: formData,
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text || "Invalid JSON" };
  }

  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Upload failed (${res.status})`;
    throw new Error(message);
  }

  return (parsed ?? {}) as ChatAttachmentUploadResponse;
}

function formatMessageTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function readTalkMeCustomFields(): ReturnType<typeof buildTalkMeCustomFields> | undefined {
  const raw = getVpnTalkmeProfileRaw();
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as Parameters<typeof buildTalkMeCustomFields>[0];
    return buildTalkMeCustomFields(parsed);
  } catch {
    return undefined;
  }
}

const Chat = () => {
  const { email, items, handleLogout } = useDashboardSidebarItems();
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [searchId, setSearchId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [operatorTyping, setOperatorTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clientLookupBody = useMemo(() => {
    if (searchId) return { searchId };
    if (clientId) return { clientId };
    return null;
  }, [clientId, searchId]);

  const loadMessages = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!clientLookupBody) return;
      if (!silent) setMessagesLoading(true);
      try {
        const data = await postJson<MessagesResponse>("/talkme/messages", {
          ...clientLookupBody,
          limit: 200,
        });
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить сообщения");
      } finally {
        if (!silent) setMessagesLoading(false);
      }
    },
    [clientLookupBody],
  );

  const refreshMeta = useCallback(async () => {
    const requests: Promise<void>[] = [
      postJson<OperatorListResponse>("/talkme/operator-list", {})
        .then((data) => setOnlineCount(typeof data.onlineCount === "number" ? data.onlineCount : null))
        .catch(() => setOnlineCount(null)),
    ];

    if (clientLookupBody) {
      requests.push(
        postJson<DialogStatusResponse>("/talkme/dialog-status", clientLookupBody)
          .then((data) => setStatusLabel(data.statusLabel || null))
          .catch(() => setStatusLabel(null)),
      );
    }

    if (clientId) {
      requests.push(
        postJson<OperatorTypingResponse>("/talkme/operator-typing-status", { clientId })
          .then((data) => setOperatorTyping(data.typing === true))
          .catch(() => setOperatorTyping(false)),
      );
    } else {
      setOperatorTyping(false);
    }

    await Promise.all(requests);
  }, [clientId, clientLookupBody]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    postJson<ClientIdResponse>("/talkme/client-id", { email })
      .then((data) => {
        if (cancelled) return;
        const syntheticClientId = typeof data.clientId === "string" ? data.clientId.trim() : "";
        if (!syntheticClientId) return;

        setClientId((prev) => prev || syntheticClientId);
        ensureTalkMeScript({ clientId: syntheticClientId });

        const syncClientInfo = () => {
          if (cancelled) return;
          setTalkMeClientInfo({
            email,
            custom: readTalkMeCustomFields(),
          });
        };
        syncClientInfo();
        window.setTimeout(syncClientInfo, 800);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;
    fetch(`${apiBase}/announcement`)
      .then((r) => r.json() as Promise<{ text?: unknown }>)
      .then((data) => {
        if (cancelled) return;
        if (typeof data?.text === "string" && data.text.trim()) {
          setAnnouncement(data.text.trim());
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;
    setInitialLoading(true);
    setError(null);

    postJson<ClientSearchResponse>("/talkme/client-search", { email })
      .then((data) => {
        if (cancelled) return;
        const client = Array.isArray(data.clients) ? data.clients[0] : null;
        setClientId((prev) => client?.clientId || prev);
        setSearchId(typeof client?.searchId === "number" ? client.searchId : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось подключиться к чату");
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    void loadMessages({ silent: true });
  }, [loadMessages]);

  useEffect(() => {
    void refreshMeta();
    const timer = window.setInterval(() => {
      void loadMessages({ silent: true });
      void refreshMeta();
    }, 6000);

    return () => window.clearInterval(timer);
  }, [loadMessages, refreshMeta]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, operatorTyping]);

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    const fileToSend = selectedFile;
    if (!email || sending || (!text && !fileToSend)) return;

    const optimisticText = [text, fileToSend ? `Файл: ${fileToSend.name}` : ""].filter(Boolean).join("\n");

    const optimisticMessage: ChatMessage = {
      id: -Date.now(),
      text: optimisticText,
      sender: "client",
      operatorName: null,
      dateTime: new Date().toISOString(),
      status: "sending",
    };

    setDraft("");
    clearSelectedFile();
    setMessages((prev) => [...prev, optimisticMessage]);
    setSending(true);
    setError(null);

    try {
      const attachment = fileToSend ? await uploadChatAttachment(fileToSend) : null;
      if (fileToSend && !attachment?.url) {
        throw new Error("Файл загружен, но сервер не вернул ссылку");
      }
      const data = await postJson<SendResponse>("/talkme/send", {
        text,
        attachmentUrl: attachment?.url || undefined,
        attachmentName: attachment?.fileName || fileToSend?.name || undefined,
        email,
        name: buildTalkMeVisitorName(),
        clientId: clientId || undefined,
        custom: readTalkMeCustomFields(),
      });

      const nextClientId = data.clientId || clientId;
      if (data.clientId) setClientId(data.clientId);
      try {
        if (nextClientId) {
          const messagesData = await postJson<MessagesResponse>("/talkme/messages", {
            clientId: nextClientId,
            limit: 200,
          });
          setMessages(Array.isArray(messagesData.messages) ? messagesData.messages : []);
        } else {
          await loadMessages({ silent: true });
        }
      } catch {
        setError("Сообщение отправлено, но историю пока не удалось обновить");
      }
      await refreshMeta();
    } catch (err) {
      setDraft(text);
      setSelectedFile(fileToSend);
      setMessages((prev) => prev.filter((message) => message.id !== optimisticMessage.id));
      setError(err instanceof Error ? err.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  return (
    <LandingShell className="landing-root--with-sidebar">
      <DashboardSidebar items={items} onLogout={handleLogout} email={email || undefined} />

      <main>
        <section className="app-page">
          <div className="container">
            {announcement ? (
              <section
                className="support-card support-announcement support-announcement--page-start"
                role="status"
                aria-label="Важное объявление"
              >
                <h2 className="support-card__title">Важное объявление</h2>
                <p className="support-card__subtitle whitespace-pre-wrap">{announcement}</p>
              </section>
            ) : null}

            <div className="app-page__eyebrow">Поддержка 220v</div>
            <h1 className="app-page__title">Чат с поддержкой</h1>
            <p className="app-page__subtitle">
              Если по какой то причине чат не работает, попробуйте написать нам на почту{" "}
              <a href="mailto:support@220v.shop" className="support-meta__link">
                support@220v.shop
              </a>
              .
            </p>

            <div className="support-layout support2-layout">
              <section className="support-card support2-chat">
                <div className="support2-chat__header">
                  <div>
                    <h2 className="support-card__title">Диалог с оператором</h2>
                    <p className="support-card__subtitle">
                      {email ? `Вы пишете как ${email}` : "Подключаем профиль пользователя..."}
                    </p>
                  </div>
                  <div className="support2-chat__badges" aria-label="Статус чата">
                    <span className="support2-chat__badge">
                      {onlineCount === null
                        ? "Операторы: проверяем"
                        : onlineCount > 0
                          ? `Операторы онлайн: ${onlineCount}`
                          : "Операторы офлайн"}
                    </span>
                    {statusLabel ? <span className="support2-chat__badge">{statusLabel}</span> : null}
                  </div>
                </div>

                {error ? (
                  <div className="support2-chat__error" role="alert">
                    {error}
                  </div>
                ) : null}

                <div className="support2-chat__messages" aria-live="polite">
                  {initialLoading ? (
                    <div className="support2-chat__state">
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                      Подключаемся к Talk-Me...
                    </div>
                  ) : messages.length > 0 ? (
                    messages.map((message) => (
                      <article
                        key={message.id}
                        className={`support2-message support2-message--${message.sender}`}
                      >
                        <div className="support2-message__bubble">
                          <div className="support2-message__meta">
                            <span>{message.sender === "operator" ? message.operatorName || "Оператор" : "Вы"}</span>
                            {message.dateTime ? <time>{formatMessageTime(message.dateTime)}</time> : null}
                          </div>
                          <p>{message.text}</p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="support2-chat__state">
                      Напишите первое сообщение, и мы откроем диалог с оператором.
                    </div>
                  )}

                  {operatorTyping ? (
                    <div className="support2-chat__typing">Оператор печатает...</div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>

                <form className="support2-chat__form" onSubmit={handleSubmit}>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Опишите вопрос..."
                    rows={3}
                    disabled={!email || sending}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="support2-chat__actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,.zip"
                      className="support2-chat__file-input"
                      onChange={handleFileChange}
                      disabled={!email || sending}
                    />
                    <button
                      type="button"
                      className="support2-chat__attach"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!email || sending}
                      aria-label="Прикрепить файл"
                      title="Прикрепить файл"
                    >
                      <Paperclip size={18} aria-hidden="true" />
                    </button>
                    {selectedFile ? (
                      <div className="support2-chat__file" title={selectedFile.name}>
                        <span>{selectedFile.name}</span>
                        <button type="button" onClick={clearSelectedFile} aria-label="Убрать файл" disabled={sending}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="submit"
                      className="btn btn--primary support2-chat__send"
                      disabled={!email || (!draft.trim() && !selectedFile) || sending}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send size={16} />}
                      Отправить
                    </button>
                  </div>
                </form>

                {messagesLoading ? <p className="support2-chat__sync">Обновляем сообщения...</p> : null}
              </section>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </LandingShell>
  );
};

export default Chat;
