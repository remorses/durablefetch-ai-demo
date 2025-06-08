"use client";

import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect } from "react";
import { DurableFetchClient } from "durablefetch";
import Markdown from "react-markdown";
import { z } from "zod";
import { useSearchParams } from "next/navigation";

const df = new DurableFetchClient();

export default function Chat() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    {
      window.location.href = `/?chatId=${Math.random().toString(36).substring(2)}`;
      return null;
    }
  }
  // api path must be unique per chat
  const api = `/api/chat?chatId=${chatId}`;
  useEffect(() => {
    df.isInProgress(api).then(({ inProgress }) => {
      if (inProgress) {
        console.log(`resuming the previous chat message stream`);
        const text = localStorage.getItem("lastMessage") || "";
        return sendMessage({
          text,
        });
      }
    });
  }, []);

  const { messages, sendMessage, error } = useChat({
    transport: new DefaultChatTransport({ api, fetch: df.fetch }),
    onFinish() {
      localStorage.setItem("lastMessage", "");
    },
    id: chatId,
    dataPartSchemas: {
      generateWriting: z.object({
        text: z.string(),
      }),
    },
  });

  const [containerRef, endRef] = useScrollToBottom();

  if (error) return <div>{error.message}</div>;

  return (
    <div className="flex flex-col w-full h-dvh py-8 stretch">
      <div className="space-y-4 flex-grow overflow-y-auto" ref={containerRef}>
        {messages.map((m) => {
          if (!m.parts?.length) return;
          return (
            <div key={m.id} className="max-w-xl mx-auto">
              <div className="font-bold">{m.role}</div>
              <div className="space-y-4">
                {m.parts.map((p, i) => {
                  switch (p.type) {
                    case "text":
                      return (
                        <div key={i} className="whitespace-pre-wrap">
                          <div>
                            <p>{p.text}</p>
                          </div>
                        </div>
                      );
                    case "tool-invocation":
                      return (
                        <div key={i} className="">
                          <p>Calling tool {p.toolInvocation.toolName}</p>
                        </div>
                      );
                    case "data-generateWriting":
                      return (
                        <div key={i} className="whitespace-pre-wrap">
                          <div className="font-mono rounded-lg text-gray-800 p-6 py-3 -ml-6 text-xs bg-white leading-relaxed tracking-wide w-full">
                            <Markdown>{p.data.text}</Markdown>
                          </div>
                        </div>
                      );

                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          );
        })}
        <div ref={endRef} className="h-2" />
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await df.delete(api)
          const formData = new FormData(e.currentTarget);
          const message = formData.get("message") as string;
          if (message.trim()) {
            sendMessage({ text: message });
            localStorage.setItem("lastMessage", message);
            e.currentTarget.reset();
          }
        }}
        className="w-full max-w-xl mx-auto"
      >
        <input
          autoFocus
          className="w-full p-2 border border-gray-300 rounded shadow-xl"
          name="message"
          placeholder="Say something..."
        />
      </form>
    </div>
  );
}
