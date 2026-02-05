import { useState } from 'react';
import { useStore } from '../store';

export function LoginForm() {
  const [inputToken, setInputToken] = useState('');
  const { setToken, error } = useStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputToken.trim()) {
      setToken(inputToken.trim());
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-5xl">🔐</span>
          <h1 className="text-2xl font-bold text-white mt-4">CLI-Online</h1>
          <p className="text-gray-400 mt-2">Claude Code Web Assistant</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-300 mb-2">
              认证 Token
            </label>
            <input
              type="password"
              id="token"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="输入你的 AUTH_TOKEN"
              className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!inputToken.trim()}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            连接
          </button>
        </form>

        <div className="mt-6 text-center text-gray-500 text-sm">
          <p>Token 在服务器的 <code className="bg-gray-700 px-1 rounded">server/.env</code> 文件中配置</p>
        </div>
      </div>
    </div>
  );
}
