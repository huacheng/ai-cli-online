import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStore } from '../store';
import type { Message } from '../types';

function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isRunning = message.status === 'running';
  const isError = message.status === 'error';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : isError
            ? 'bg-red-100 text-red-900 border border-red-300'
            : 'bg-white text-gray-900 border border-gray-200'
        }`}
      >
        {/* Role indicator */}
        <div
          className={`text-xs mb-1 ${
            isUser ? 'text-blue-200' : 'text-gray-500'
          }`}
        >
          {isUser ? '👤 你' : '🤖 Claude Code'}
          {isRunning && (
            <span className="ml-2 inline-flex items-center">
              <span className="animate-pulse">⚡ 执行中...</span>
            </span>
          )}
          {isError && <span className="ml-2">❌ 错误</span>}
        </div>

        {/* Message content */}
        {isRunning && !message.content ? (
          <div className="flex items-center gap-2 text-gray-500">
            <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full" />
            <span>正在执行任务...</span>
          </div>
        ) : (
          <div className={`prose prose-sm max-w-none ${isUser ? 'prose-invert' : ''}`}>
            <ReactMarkdown
              components={{
                // Style code blocks
                code({ className, children, ...props }) {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code
                        className={`${
                          isUser ? 'bg-blue-700' : 'bg-gray-100'
                        } px-1 py-0.5 rounded text-sm`}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto">
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  );
                },
                // Style pre blocks
                pre({ children }) {
                  return <>{children}</>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-xs mt-2 ${
            isUser ? 'text-blue-200' : 'text-gray-400'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

export function MessageList() {
  const { messages } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="text-6xl mb-4">💬</div>
          <p className="text-lg">开始你的第一个任务</p>
          <p className="text-sm mt-2">
            在下方输入框中描述你想让 Claude Code 执行的任务
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
