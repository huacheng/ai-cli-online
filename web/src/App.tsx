import { useWebSocket } from './hooks/useWebSocket';
import { useStore } from './store';
import { WorkingDirBar } from './components/WorkingDirBar';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import { LoginForm } from './components/LoginForm';

function App() {
  const { sendMessage, setWorkingDirectory } = useWebSocket();
  const { error, setError, token, setToken } = useStore();

  // Show login form if no token
  if (!token) {
    return <LoginForm />;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🚀</span>
          <h1 className="text-xl font-bold">CLI-Online</h1>
          <span className="text-gray-400 text-sm">Claude Code Web Assistant</span>
        </div>
        <button
          onClick={() => setToken(null)}
          className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded hover:bg-gray-700"
        >
          退出
        </button>
      </header>

      {/* Working Directory Bar */}
      <WorkingDirBar onChangeDir={setWorkingDirectory} />

      {/* Error Banner */}
      {error && (
        <div className="bg-red-100 border-b border-red-300 text-red-700 px-4 py-2 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <MessageList />
        <MessageInput onSend={sendMessage} />
      </main>
    </div>
  );
}

export default App;
