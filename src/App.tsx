import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text: "Hi! Write anything and I will send the exact same text back.",
    },
  ]);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(2);

  const canSend = useMemo(() => input.trim().length > 0, [input]);

  useEffect(() => {
    const onAssistantTriggered = () => {
      textareaRef.current?.focus();
    };

    window.addEventListener("assistantTriggered", onAssistantTriggered);
    return () => {
      window.removeEventListener("assistantTriggered", onAssistantTriggered);
    };
  }, []);

  const sendMessage = () => {
    const text = input.trim();
    if (!text) {
      return;
    }

    const userMessage: ChatMessage = { id: nextId.current++, role: "user", text };
    const assistantMessage: ChatMessage = {
      id: nextId.current++,
      role: "assistant",
      text,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput("");
    textareaRef.current?.focus();
  };

  const onTextareaKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <main className="w-full max-w-3xl mx-auto min-h-screen p-4 md:p-8 flex items-center">
      <section className="w-full rounded-2xl border border-white/15 bg-black/35 backdrop-blur p-4 md:p-6 shadow-xl">
        <h1 className="text-2xl md:text-3xl font-semibold mb-2">AI Chat</h1>
        <p className="text-white/70 text-sm mb-4">The bot always echoes your message back.</p>

        <div className="rounded-xl border border-white/10 bg-black/25 p-3 h-80 overflow-y-auto space-y-3">
          {messages.map(message => (
            <div
              key={message.id}
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                message.role === "user"
                  ? "ml-auto bg-cyan-500/25 border border-cyan-300/20"
                  : "mr-auto bg-white/10 border border-white/10"
              }`}
            >
              {message.text}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          <textarea
            ref={textareaRef}
            rows={4}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder="Type a message..."
            className="w-full rounded-xl border border-white/20 bg-black/25 px-3 py-2 resize-none outline-none focus:border-cyan-300/50"
          />
          <button
            type="button"
            disabled={!canSend}
            onClick={sendMessage}
            className="justify-self-end rounded-xl bg-cyan-400/85 text-black font-medium px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;
