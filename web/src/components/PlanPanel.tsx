import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MarkdownEditor } from './MarkdownEditor';
import { fetchLatestPlan, savePlanFile, fetchPaneCommand } from '../api/plans';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  onClose: () => void;
  onSend: (text: string) => void;
}

const POLL_INTERVAL = 3000;

export function PlanPanel({ sessionId, token, onClose, onSend }: PlanPanelProps) {
  // Left side: plan file content from ~/.claude/plans/
  const [planContent, setPlanContent] = useState('');
  const [planName, setPlanName] = useState('');
  const planMtimeRef = useRef(0);

  // Save-as filename
  const [saveFilename, setSaveFilename] = useState(() => {
    try {
      return localStorage.getItem(`cli-online-plan-filename-${sessionId}`) || 'plan.md';
    } catch {
      return 'plan.md';
    }
  });
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string>('');

  // Left/right split ratio
  const [leftWidthPercent, setLeftWidthPercent] = useState(50);

  // Poll for plan file updates — only when claude is running in this terminal
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        // Check if claude is running in this session's pane
        const cmd = await fetchPaneCommand(token, sessionId);
        if (cancelled) return;
        if (!cmd || !cmd.toLowerCase().includes('claude')) return; // skip if no claude

        const since = planMtimeRef.current;
        const plan = await fetchLatestPlan(token, sessionId, since);
        if (cancelled) return;
        if (plan) {
          setPlanContent(plan.content);
          setPlanName(plan.name);
          planMtimeRef.current = plan.mtime;
        }
      } catch {
        // ignore polling errors
      }
    };

    // Immediate first fetch
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, sessionId]);

  // Persist filename to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`cli-online-plan-filename-${sessionId}`, saveFilename);
    } catch { /* ignore */ }
  }, [saveFilename, sessionId]);

  // Save plan content to CWD
  const handleSave = useCallback(async () => {
    if (!planContent || saving) return;
    setSaving(true);
    setSaveResult('');
    try {
      const path = await savePlanFile(token, sessionId, saveFilename, planContent);
      setSaveResult(path);
      setTimeout(() => setSaveResult(''), 3000);
    } catch (err) {
      console.error('[plan:save]', err);
      setSaveResult('Failed');
      setTimeout(() => setSaveResult(''), 3000);
    } finally {
      setSaving(false);
    }
  }, [planContent, saving, token, sessionId, saveFilename]);

  // Horizontal divider drag
  const containerRef = useRef<HTMLDivElement>(null);
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;

    document.body.classList.add('resizing-panes-h');

    let dragRafId: number | null = null;
    const onMouseMove = (ev: MouseEvent) => {
      if (dragRafId) return;
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null;
        const relX = ev.clientX - rect.left;
        const pct = Math.min(80, Math.max(20, (relX / containerWidth) * 100));
        setLeftWidthPercent(pct);
      });
    };

    const onMouseUp = () => {
      if (dragRafId) cancelAnimationFrame(dragRafId);
      document.body.classList.remove('resizing-panes-h');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1a1b26',
      overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        height: '28px',
        flexShrink: 0,
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
        gap: '6px',
      }}>
        {/* Left: plan name + save controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#565f89', marginRight: '2px' }}>
            {planName || 'Plan'}
          </span>
          <input
            className="plan-filename-input"
            value={saveFilename}
            onChange={(e) => setSaveFilename(e.target.value)}
            placeholder="filename.md"
            title="Filename for saving plan to CWD"
          />
          <button
            className="pane-btn"
            onClick={handleSave}
            disabled={!planContent || saving}
            title="Save plan file to session CWD"
            style={!planContent || saving ? { opacity: 0.4, cursor: 'default' } : { color: '#9ece6a' }}
          >
            {saving ? '...' : 'Save'}
          </button>
          {saveResult && (
            <span style={{
              fontSize: '11px',
              color: saveResult === 'Failed' ? '#f7768e' : '#9ece6a',
              maxWidth: '400px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {saveResult === 'Failed' ? 'Failed' : `Saved: ${saveResult}`}
            </span>
          )}
        </div>

        {/* Right: close */}
        <button
          className="pane-btn pane-btn--danger"
          onClick={onClose}
          title="Close Plan panel"
        >
          ×
        </button>
      </div>

      {/* Left/Right split body */}
      <div ref={containerRef} className="plan-panel-body">
        {/* Left: Plan renderer */}
        <div className="plan-renderer" style={{ width: `${leftWidthPercent}%`, flexShrink: 0 }}>
          <MarkdownRenderer content={planContent} />
        </div>

        {/* Horizontal divider */}
        <div className="plan-divider-h" onMouseDown={handleDividerMouseDown} />

        {/* Right: Editor */}
        <div className="plan-editor-wrap">
          <MarkdownEditor
            onSend={onSend}
            onClose={onClose}
            sessionId={sessionId}
            token={token}
            hideToolbar
          />
        </div>
      </div>
    </div>
  );
}
