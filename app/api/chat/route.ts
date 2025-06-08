import { openai } from "@ai-sdk/openai";
import { OpenAIProviderOptions } from "@ai-sdk/openai/internal";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  streamText,
  tool,
  UIMessage,
} from "ai";
import fs from "fs";
import { z } from "zod";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const stream = createUIMessageStream({
    originalMessages: messages,
    async onFinish(options) {
      fs.writeFileSync(
        "messages.json",
        JSON.stringify(options.messages, null, 2),
      );
      {
        const array = await streamToArray(uiStream2);
        fs.writeFileSync("ui-stream.json", JSON.stringify(array, null, 2));
      }
    },
    execute: (opts) => {
      opts.writer;
      const result = streamText({
        model: openai("gpt-4.1-mini"),
        messages: convertToModelMessages(messages),
        stopWhen: () => false,
        providerOptions: {
          openai: {
            parallelToolCalls: true,
          } satisfies OpenAIProviderOptions,
        },
        onFinish(data) {},

        tools: {
          getWeather: tool({
            description: "Get the current weather at a location",
            parameters: z.object({
              latitude: z.number(),
              longitude: z.number(),
              city: z.string(),
            }),
            execute: async ({ latitude, longitude, city }, { toolCallId }) => {
              const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode,relativehumidity_2m&timezone=auto`,
              );
              opts.writer.write({
                type: "data-weather",
                data: {
                  temperature: undefined,
                  weatherCode: undefined,
                  humidity: undefined,
                  city,
                  loading: false,
                },
                id: toolCallId,
              });

              const weatherData = await response.json();
              opts.writer.write({
                type: "data-weather",
                data: {
                  temperature: weatherData.current.temperature_2m,
                  weatherCode: weatherData.current.weathercode,
                  humidity: weatherData.current.relativehumidity_2m,
                  city,
                  loading: false,
                },
                id: toolCallId,
              });
              return {
                temperature: weatherData.current.temperature_2m,
                weatherCode: weatherData.current.weathercode,
                humidity: weatherData.current.relativehumidity_2m,
                city,
              };
            },
          }),
          generateWriting: tool({
            description: "Write something (email, poem etc.).",
            parameters: z.object({ prompt: z.string() }),
            execute: async ({ prompt }, { toolCallId }) => {
              const result = streamText({
                model: openai("gpt-4.1-nano"),
                system:
                  "You are an expert writer. Follow the users instructions. Write no more than 100 words",
                prompt,
                experimental_transform: smoothStream({ chunking: /.{1}/g }),
              });

              let writing = "";
              for await (const delta of result.textStream) {
                writing += delta;
                opts.writer.write({
                  type: "data-generateWriting",
                  data: {
                    text: writing,
                  },
                  id: toolCallId,
                });
              }
              return {
                prompt,
                text: await result.text,
              };
            },
          }),
          generateCode: tool({
            description: "Generate code based on requirements",
            parameters: z.object({ repo: z.string() }),
            execute: async ({ repo }) => {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              return "Generated 3 files for " + repo;
            },
          }),
          createPR: tool({
            description: "Create a pull request with generated code",
            parameters: z.object({
              branch: z.string(),
            }),
            execute: async ({ branch }) => {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              return "Created a PR for " + branch;
            },
          }),
        },
      });

      const uiStream = result.toUIMessageStream({
        originalMessages: messages,
        sendFinish: true,
        messageMetadata(options) {},

        onError: (error) => {
          if (error instanceof Error) {
            return error.message;
          }
          console.error(error);
          return "An unknown error occurred.";
        },
      });

      opts.writer.merge(uiStream);
    },
  });
  const [cloned, uiStream2] = stream.tee();

  return createUIMessageStreamResponse({ stream: cloned });
}

async function streamToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks;
}
