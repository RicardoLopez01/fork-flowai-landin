"use client";

import React, { useState, useRef, useEffect } from "react";
import { X, Send, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

const CHAT_API_URL = process.env.NEXT_PUBLIC_CHAT_API_URL || "http://localhost:7071";

type Message = { role: "user" | "assistant"; content: string };

/** Parse an SSE data payload: JSON-encoded string or raw text fallback */
function parseSSEData(raw: string): string {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch { /* fallback to raw */ }
  }
  return raw;
}

/** Normalize markdown: fix ** bold ** and ** stuck to words (e.g. "reducción**en" -> "reducción **en") */
function normalizeMarkdown(text: string): string {
  let out = text.replace(/\*\*\s*([^*]+?)\s*\*\*/g, "**$1**");
  out = out.replace(/([a-záéíóúñ])(\*\*)(?=[a-záéíóúñA-Z])/gi, "$1 $2");
  return out;
}

interface ChatModalProps {
  open: boolean;
  onClose: () => void;
  /** When true, renders as a bottom-right floating panel instead of centered modal */
  floating?: boolean;
}

export default function ChatModal({ open, onClose, floating = false }: ChatModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const res = await fetch(`${CHAT_API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || "Error al conectar con el asistente");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.startsWith("data: ")) {
            const raw = trimmed.slice(6).trim();
            if (raw === "[DONE]" || raw === "[ERROR]") continue;
            assistantContent += parseSSEData(raw);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: assistantContent };
              }
              return next;
            });
          }
        }
      }
      if (buffer.trim().startsWith("data: ")) {
        const raw = buffer.trim().slice(6).trim();
        if (raw !== "[DONE]" && raw !== "[ERROR]") {
          assistantContent += parseSSEData(raw);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: assistantContent };
            }
            return next;
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error de conexión";
      setError(message);
      setMessages((prev) => {
        const next = [...prev];
        if (next[next.length - 1]?.role === "assistant" && next[next.length - 1].content === "") {
          next[next.length - 1] = { role: "assistant", content: `No pude conectar con el asistente. (${message})` };
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  if (!open) return null;

  const panelClass = floating
    ? "fixed bottom-20 right-6 z-50 w-full max-w-md rounded-xl border border-white/10 bg-dark-card shadow-2xl shadow-black/40"
    : "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-dark-card shadow-2xl shadow-black/40";

  const panelHeight = floating ? "min(85vh, 520px)" : "min(70vh, 420px)";

  return (
    <>
      {!floating && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-modal-title"
        className={panelClass}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 id="chat-modal-title" className="text-lg font-semibold text-primary">
            Asistente Flow AI
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col" style={{ height: panelHeight }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-base text-muted-foreground text-center py-6">
                Hola. Escribe aquí tu pregunta sobre Flow AI o cómo agendar una demo.
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-base max-w-[85%] leading-relaxed",
                  msg.role === "user"
                    ? "ml-auto bg-primary/20 text-primary border border-primary/30"
                    : "mr-auto bg-white/5 text-foreground border border-white/10"
                )}
              >
                {msg.role === "assistant" && msg.content ? (
                  <div className="markdown-chat text-foreground text-[15px] leading-relaxed [&_ul]:list-disc [&_ul]:list-inside [&_ol]:list-decimal [&_ol]:list-inside [&_p]:mb-2 [&_a]:text-primary [&_a]:underline">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                        a: ({ href, children }) => (
                          <Link href={href || "#"} className="text-primary hover:underline">
                            {children}
                          </Link>
                        ),
                      }}
                    >
                      {normalizeMarkdown(msg.content)}
                    </ReactMarkdown>
                    {streaming && i === messages.length - 1 && (
                      <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse align-middle" />
                    )}
                  </div>
                ) : msg.role === "assistant" && streaming && i === messages.length - 1 ? (
                  <span className="flex items-center gap-1 text-muted-foreground text-base">
                    <Loader2 size={16} className="animate-spin" /> Escribiendo...
                  </span>
                ) : msg.role === "user" ? (
                  msg.content
                ) : null}
                {msg.role === "assistant" && msg.content && !streaming && i === messages.length - 1 && (
                  <div className="mt-2">
                    <Link
                      href="/calendar"
                      className="text-primary hover:underline text-sm font-medium"
                    >
                      Agendar reunión / Solicitar demo
                    </Link>
                  </div>
                )}
              </div>
            ))}
            {error && (
              <p className="text-base text-destructive text-center">{error}</p>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 p-3 flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              disabled={streaming}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
              aria-label="Mensaje"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || streaming}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Enviar"
            >
              {streaming ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
