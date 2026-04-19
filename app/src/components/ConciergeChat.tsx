"use client";

/*
 * ConciergeChat — AI コンシェルジュのメインチャット UI。
 * DS v2 §15.3 ランディング + §15.4 チャット画面 を統合。
 *
 * Phase 1 MVP:
 *   - ランディング（空状態）に suggested prompts 4 枠
 *   - 送信 → /api/concierge へ POST、応答を吹き出しで追加
 *   - tool_use 提案が来たら ConciergeToolCard で確認カード表示
 *   - 確認で store-client 側 API を呼び、実データを更新
 *   - エラー 3 種（rate_limit / daily / monthly_budget）をテロップ表示
 */

import { Box, Text, Textarea } from "@mantine/core";
import { IconSend, IconLock, IconAlertCircle, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { ConciergeToolCard, type AddStepToolInput } from "@/components/ConciergeToolCard";
import { getJourneys, updateJourney, generateId } from "@/lib/store-client";
import type { Journey, StepCategory } from "@/lib/types";
import classes from "./ConciergeChat.module.css";

type ToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolUse?: ToolUse | null;
  // tool 実行結果（Phase 1 はローカル state のみ）
  toolResult?: { ok: boolean; note?: string };
};

const SUGGESTED = [
  "次の出張、準備は足りてる？",
  "来週の予定をまとめて",
  "乗継時間は十分？",
  "到着後の動線を教えて",
];

export function ConciergeChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getJourneys().then(setJourneys);
  }, []);

  useEffect(() => {
    // 新メッセージ追加で自動スクロール
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setError(null);
    setSending(true);
    const userMsg: Message = { id: generateId(), role: "user", content: body };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const res = await fetch("/api/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        const kind = data?.error ?? "unknown";
        const msg = data?.message ?? "送信に失敗しました。しばらくしてからお試しください。";
        setError({ kind, message: msg });
        return;
      }
      if (data.threadId && !threadId) setThreadId(data.threadId);
      const ai: Message = {
        id: generateId(),
        role: "assistant",
        content: data.assistant?.content ?? "",
        toolUse: data.assistant?.toolUse ?? null,
      };
      setMessages((prev) => [...prev, ai]);
    } catch (e) {
      console.error("[concierge] send failed:", e);
      setError({ kind: "network", message: "通信エラーが発生しました。電波状況を確認してお試しください。" });
    } finally {
      setSending(false);
    }
  };

  // Tool Use 確認: add_step の実行
  const confirmAddStep = async (messageId: string, input: AddStepToolInput) => {
    const journey = journeys.find((j) => j.id === input.journey_id);
    if (!journey) {
      markToolResult(messageId, { ok: false, note: "対象の Journey が見つかりません" });
      return;
    }
    try {
      await updateJourney(journey.id, {
        steps: [...journey.steps, {
          id: generateId(),
          category: input.category as StepCategory,
          title: input.title,
          date: input.date || undefined,
          time: input.time || "",
          endTime: input.endTime || undefined,
          from: input.from || undefined,
          to: input.to || undefined,
          source: "手入力",
          status: "未開始",
          information: [],
        }],
      });
      // Journey state を更新
      const fresh = await getJourneys();
      setJourneys(fresh);
      markToolResult(messageId, { ok: true, note: `${journey.title} に追加しました` });
    } catch {
      markToolResult(messageId, { ok: false, note: "追加に失敗しました" });
    }
  };

  const declineTool = (messageId: string) => {
    markToolResult(messageId, { ok: false, note: "キャンセルしました" });
  };

  const markToolResult = (messageId: string, result: { ok: boolean; note?: string }) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, toolResult: result } : m)));
  };

  const isLanding = messages.length === 0 && !sending;

  return (
    <>
      <AppHeader title="コンシェルジュ" />
      <Box className={classes.screen}>
        <Box className={classes.scrollArea} ref={scrollRef}>
          {isLanding ? (
            <Box className={classes.landing}>
              <Box className={classes.greeting}>
                <Text className={classes.greetingEyebrow}>CONCIERGE</Text>
                <Box className={classes.greetingBody}>
                  <Text className={classes.greetingTitle}>
                    なにかお手伝いできることはありますか？
                  </Text>
                  <Text className={classes.greetingSub}>
                    登録済みの旅程から準備の抜けチェックや、当日の動線をご提案します。
                  </Text>
                </Box>
              </Box>
              <Text className={classes.suggestedLabel}>SUGGESTED</Text>
              <Box className={classes.suggestedList}>
                {SUGGESTED.map((text) => (
                  <button
                    key={text}
                    type="button"
                    className={classes.suggestedItem}
                    onClick={() => send(text)}
                  >
                    <span>{text}</span>
                    <IconChevronRight size={14} className={classes.suggestedChev} />
                  </button>
                ))}
              </Box>
              <Box className={classes.piiNote}>
                <IconLock size={12} />
                <span>確認番号・マイレージ等は末尾のみの送信で保護されます。</span>
              </Box>
            </Box>
          ) : (
            <Box className={classes.thread}>
              {messages.map((m) => (
                <Box key={m.id} className={classes.messageRow}>
                  {m.content && (
                    <>
                      <Text className={classes.roleLabel} data-role={m.role}>
                        {m.role === "user" ? "YOU" : "CONCIERGE"}
                      </Text>
                      <Box className={classes.bubble} data-role={m.role}>
                        {m.content.split("\n").map((line, i) => (
                          <Text key={i} component="div" className={classes.bubbleText}>{line || "\u00A0"}</Text>
                        ))}
                      </Box>
                    </>
                  )}
                  {m.role === "assistant" && m.toolUse && m.toolUse.name === "add_step" && (
                    <ConciergeToolCard
                      input={m.toolUse.input as AddStepToolInput}
                      journeys={journeys}
                      result={m.toolResult}
                      onConfirm={() => confirmAddStep(m.id, m.toolUse!.input as AddStepToolInput)}
                      onDecline={() => declineTool(m.id)}
                    />
                  )}
                </Box>
              ))}
              {sending && (
                <Box className={classes.messageRow}>
                  <Text className={classes.roleLabel} data-role="assistant">CONCIERGE</Text>
                  <Box className={classes.bubble} data-role="assistant" data-loading="true">
                    考え中...
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {error && (
            <Box className={classes.errorBanner} data-kind={error.kind}>
              <IconAlertCircle size={16} />
              <Text size="xs">{error.message}</Text>
            </Box>
          )}
        </Box>

        <Box className={classes.composer}>
          <Textarea
            className={classes.composerInput}
            placeholder={isLanding ? "質問やお願いを入力" : "続けて質問..."}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            autosize
            minRows={1}
            maxRows={4}
            disabled={sending}
          />
          <button
            type="button"
            className={classes.sendButton}
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            aria-label="送信"
          >
            <IconSend size={18} />
          </button>
        </Box>
      </Box>
      <TabBar />
    </>
  );
}
