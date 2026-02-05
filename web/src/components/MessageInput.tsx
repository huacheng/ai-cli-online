import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';

// Command definitions
interface Command {
  name: string;
  description: string;
  type: 'local' | 'passthrough';
}

const COMMANDS: Command[] = [
  { name: '/clear', description: '清除会话历史', type: 'local' },
  { name: '/help', description: '显示帮助信息', type: 'passthrough' },
  { name: '/model', description: '查看或切换模型', type: 'passthrough' },
  { name: '/compact', description: '压缩对话历史', type: 'passthrough' },
  { name: '/config', description: '查看配置信息', type: 'passthrough' },
  { name: '/cost', description: '查看费用统计', type: 'passthrough' },
];

interface MessageInputProps {
  onSend: (content: string) => void;
  onClear: () => void;
}

export function MessageInput({ onSend, onClear }: MessageInputProps) {
  const [input, setInput] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isLoading, connected } = useStore();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Filter commands based on input
  useEffect(() => {
    if (input.startsWith('/')) {
      const query = input.toLowerCase();
      const filtered = COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(query)
      );
      setFilteredCommands(filtered);
      setShowCommands(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading && connected) {
      executeInput(input.trim());
    }
  };

  const executeInput = (value: string) => {
    // Check if it's a local command
    if (value === '/clear') {
      onClear();
      setInput('');
      setShowCommands(false);
      return;
    }

    // Send to server (either passthrough command or regular message)
    onSend(value);
    setInput('');
    setShowCommands(false);
  };

  const selectCommand = (command: Command) => {
    if (command.type === 'local') {
      executeInput(command.name);
    } else {
      setInput(command.name + ' ');
      setShowCommands(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          selectCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowCommands(false);
      }
    } else {
      // Submit on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 p-4 bg-white relative">
      {/* Command menu */}
      {showCommands && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-10"
        >
          <div className="py-1">
            {filteredCommands.map((cmd, index) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => selectCommand(cmd)}
                className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-gray-100 ${
                  index === selectedIndex ? 'bg-blue-50' : ''
                }`}
              >
                <span className="font-mono text-blue-600 font-medium">
                  {cmd.name}
                </span>
                <span className="text-gray-500 text-sm">{cmd.description}</span>
                {cmd.type === 'local' && (
                  <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                    本地
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 border-t">
            <kbd className="px-1 bg-gray-200 rounded">Tab</kbd> 或{' '}
            <kbd className="px-1 bg-gray-200 rounded">Enter</kbd> 选择 ·{' '}
            <kbd className="px-1 bg-gray-200 rounded">Esc</kbd> 关闭
          </div>
        </div>
      )}

      <div className="flex gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !connected
                ? '等待连接...'
                : isLoading
                ? '等待执行完成...'
                : '输入任务描述，或 / 查看命令'
            }
            disabled={isLoading || !connected}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            rows={1}
          />
          <div className="absolute right-3 bottom-3 text-xs text-gray-400">
            Enter 发送 / Shift+Enter 换行
          </div>
        </div>
        <button
          type="submit"
          disabled={!input.trim() || isLoading || !connected}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              执行中
            </span>
          ) : (
            '发送'
          )}
        </button>
      </div>
    </form>
  );
}
