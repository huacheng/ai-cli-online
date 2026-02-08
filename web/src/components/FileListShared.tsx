/** Shared header and status UI for FileBrowser and DocumentPicker */

interface FileListHeaderProps {
  cwd: string;
  onGoUp: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function FileListHeader({ cwd, onGoUp, onRefresh, onClose }: FileListHeaderProps) {
  return (
    <div style={{
      padding: '6px 12px',
      background: '#24283b',
      borderBottom: '1px solid #414868',
      flexShrink: 0,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <button
          onClick={onGoUp}
          style={{
            background: 'none',
            border: '1px solid #414868',
            color: '#7aa2f7',
            borderRadius: 3,
            padding: '1px 8px',
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Go to parent directory"
        >
          ..
        </button>
        <span style={{
          color: '#7aa2f7',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {cwd || '...'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={onRefresh}
          style={{
            background: 'none',
            border: 'none',
            color: '#565f89',
            fontSize: 14,
            cursor: 'pointer',
            padding: '0 4px',
          }}
          title="Refresh"
        >
          &#x21bb;
        </button>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#565f89',
            fontSize: 14,
            cursor: 'pointer',
            padding: '0 4px',
          }}
          title="Close (ESC)"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
}

interface FileListStatusProps {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText?: string;
}

export function FileListStatus({ loading, error, empty, emptyText = 'Empty directory' }: FileListStatusProps) {
  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#565f89', fontSize: 13 }}>
        Loading...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: '12px', color: '#f7768e', fontSize: 12 }}>
        {error}
      </div>
    );
  }
  if (empty) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#565f89', fontSize: 13 }}>
        {emptyText}
      </div>
    );
  }
  return null;
}
