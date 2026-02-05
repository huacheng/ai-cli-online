import { useState } from 'react';
import { useStore } from '../store';

interface WorkingDirBarProps {
  onChangeDir: (dir: string) => void;
}

export function WorkingDirBar({ onChangeDir }: WorkingDirBarProps) {
  const { workingDir, connected } = useStore();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(workingDir);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onChangeDir(inputValue.trim());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setInputValue(workingDir);
    setIsEditing(false);
  };

  return (
    <div className="bg-gray-800 text-white px-4 py-2 flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-yellow-400">📁</span>
        <span className="text-gray-400 text-sm">工作目录:</span>
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-gray-700 text-white px-3 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="/path/to/directory"
            autoFocus
          />
          <button
            type="submit"
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            确认
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
          >
            取消
          </button>
        </form>
      ) : (
        <>
          <code className="flex-1 text-green-400 text-sm font-mono truncate">
            {workingDir || '(未设置)'}
          </code>
          <button
            onClick={() => {
              setInputValue(workingDir);
              setIsEditing(true);
            }}
            className="px-3 py-1 bg-gray-700 text-white rounded text-sm hover:bg-gray-600"
          >
            切换
          </button>
        </>
      )}

      <div className="flex items-center gap-2 ml-4">
        <span
          className={`w-2 h-2 rounded-full ${
            connected ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className="text-gray-400 text-xs">
          {connected ? '已连接' : '未连接'}
        </span>
      </div>
    </div>
  );
}
