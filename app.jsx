import { useState, useEffect, useRef } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Toaster, toast } from "sonner";
import {
  Copy, Check, Play, AlertTriangle, Shield, Zap, Info,
  Wand2, Github, Lock, ChevronDown, ChevronRight,
  GitCommit, Loader2, FolderOpen, FileCode, X
} from "lucide-react";

// ─── Theme tokens ────────────────────────────────────────────────────────────
const BG       = "#09090b";
const SURFACE  = "#18181b";
const BORDER   = "#27272a";
const TEXT     = "#fafafa";
const MUTED    = "#a1a1aa";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const API = "http://localhost:5000";

const SAMPLE_CODE = `function fetchUserData(userId) {
  var password = "admin123";
  eval("console.log('fetching user: " + userId + "')");
  
  fetch("http://api.example.com/users/" + userId)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      document.getElementById("user").innerHTML = data.name;
      localStorage.setItem("userData", JSON.stringify(data));
    });
}

for (var i = 0; i <= 1000; i++) {
  fetchUserData(i);
}`;

function parseReview(text) {
  const sections = {
    issues:      { icon: "🚨", label: "Issues",              color: "issues",       content: [] },
    security:    { icon: "🔐", label: "Security Risks",      color: "security",     content: [] },
    smells:      { icon: "🧹", label: "Code Smells",         color: "smells",       content: [] },
    improvements:{ icon: "⚡", label: "Improvements",        color: "improvements", content: [] },
    improvedCode:{ icon: "✨", label: "Improved Code",       color: "code",         content: [] },
    explanation: { icon: "🧠", label: "Beginner Explanation",color: "explanation",  content: [] },
  };
  const keys = [
    [/1\.\s*🚨\s*Issues?:/i, "issues"],
    [/2\.\s*🔐\s*Security/i, "security"],
    [/3\.\s*🧹\s*Code Smells?:/i, "smells"],
    [/4\.\s*⚡\s*Improvements?:/i, "improvements"],
    [/5\.\s*✨\s*Improved Code:/i, "improvedCode"],
    [/6\.\s*🧠\s*Beginner/i, "explanation"],
  ];
  let current = null;
  for (const line of text.split("\n")) {
    let matched = false;
    for (const [re, key] of keys) {
      if (re.test(line)) { current = key; matched = true; break; }
    }
    if (!matched && current) sections[current].content.push(line);
  }
  Object.values(sections).forEach(s => {
    s.text = s.content.join("\n").trim();
  });
  // Extract code block from improvedCode
  const codeMatch = sections.improvedCode.text.match(/```[\w]*\n?([\s\S]+?)```/);
  sections.improvedCode.code = codeMatch ? codeMatch[1].trim() : sections.improvedCode.text.replace(/```[\w]*/g, "").trim();
  return sections;
}

function inferLang(path) {
  const m = {".py":"python",".js":"javascript",".jsx":"jsx",".ts":"typescript",
             ".tsx":"tsx",".java":"java",".go":"go",".rb":"ruby",".php":"php",
             ".rs":"rust",".cpp":"cpp",".c":"c",".cs":"csharp",".html":"html",
             ".css":"css",".sh":"bash",".sql":"sql",".md":"markdown"};
  for (const [ext, lang] of Object.entries(m)) if (path?.endsWith(ext)) return lang;
  return "text";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text, testId }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      const el = document.createElement("textarea");
      el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      data-testid={testId || "copy-button"}
      onClick={handleCopy}
      style={{
        background: "transparent", border: `1px solid ${BORDER}`,
        color: MUTED, borderRadius: 6, padding: "4px 10px",
        cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        fontSize: 12, transition: "all .2s"
      }}
      onMouseEnter={e => { e.currentTarget.style.color = TEXT; e.currentTarget.style.borderColor = "#52525b"; }}
      onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = BORDER; }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const CARD_COLORS = {
  issues:       { bg: "rgba(239,68,68,.08)",   border: "rgba(239,68,68,.25)",   top: "#ef4444", text: "#f87171" },
  security:     { bg: "rgba(168,85,247,.08)",  border: "rgba(168,85,247,.25)",  top: "#a855f7", text: "#c084fc" },
  smells:       { bg: "rgba(245,158,11,.08)",  border: "rgba(245,158,11,.25)",  top: "#f59e0b", text: "#fbbf24" },
  improvements: { bg: "rgba(59,130,246,.08)",  border: "rgba(59,130,246,.25)",  top: "#3b82f6", text: "#60a5fa" },
  explanation:  { bg: "rgba(20,184,166,.08)",  border: "rgba(20,184,166,.25)",  top: "#14b8a6", text: "#2dd4bf" },
};

function ReviewCard({ section, data, extraAction }) {
  const c = CARD_COLORS[section] || { bg: SURFACE, border: BORDER, top: "#52525b", text: TEXT };
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`,
      borderTop: `2px solid ${c.top}`,
      borderRadius: 10, padding: "20px 22px",
      display: "flex", flexDirection: "column", gap: 10, position: "relative"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: c.text, fontWeight: 700, fontSize: 14, letterSpacing: ".04em", display: "flex", alignItems: "center", gap: 7 }}>
          <span>{data.icon}</span>{data.label}
        </span>
        {extraAction}
      </div>
      <p style={{ color: TEXT, fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
        {data.text || "—"}
      </p>
    </div>
  );
}

// ─── GitHub Panel ─────────────────────────────────────────────────────────────
function GitHubPanel({ onCodeLoaded }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);

  const fetchTree = async () => {
    if (!repoUrl.trim()) { toast.error("Enter a GitHub repo URL"); return; }
    setLoading(true);
    setTreeData(null);
    setSelectedFile(null);
    try {
      const res = await fetch(`${API}/github/tree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), token: token.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch repo");
      setTreeData(data);
      toast.success(`Loaded ${data.files.length} files from ${data.owner}/${data.repo}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const selectFile = async (file) => {
    setSelectedFile(file.path);
    onCodeLoaded({
      path: file.path,
      owner: treeData.owner,
      repo: treeData.repo,
      branch: treeData.branch,
      token: token.trim(),
      language: inferLang(file.path),
      loading: true
    });
    try {
      const res = await fetch(`${API}/github/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: treeData.owner, repo: treeData.repo, path: file.path, token: token.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCodeLoaded({
        path: file.path, owner: treeData.owner, repo: treeData.repo,
        branch: treeData.branch, token: token.trim(),
        language: inferLang(file.path),
        code: data.content, sha: data.sha, loading: false
      });
    } catch (e) {
      toast.error(e.message);
      onCodeLoaded(null);
    }
  };

  // Build a nested tree from flat paths
  const buildTree = (files) => {
    const root = {};
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]]) node[parts[i]] = { __children: {} };
        node = node[parts[i]].__children;
      }
      node[parts[parts.length - 1]] = { __file: f };
    }
    return root;
  };

  const renderTree = (node, depth = 0) => {
    return Object.entries(node).map(([name, val]) => {
      const isFile = !!val.__file;
      const path = val.__file?.path;
      const isSelected = path === selectedFile;
      if (isFile) {
        return (
          <div key={path}
            onClick={() => selectFile(val.__file)}
            style={{
              paddingLeft: depth * 14 + 8, paddingTop: 5, paddingBottom: 5, paddingRight: 8,
              cursor: "pointer", borderRadius: 5, display: "flex", alignItems: "center", gap: 7,
              background: isSelected ? "rgba(255,255,255,.07)" : "transparent",
              color: isSelected ? TEXT : MUTED, fontSize: 12.5,
              transition: "all .15s"
            }}
            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,.04)"; }}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
          >
            <FileCode size={12} style={{ flexShrink: 0, color: isSelected ? "#60a5fa" : "#52525b" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          </div>
        );
      }
      // Folder
      const key = `folder-${depth}-${name}`;
      const isOpen = expanded[key];
      return (
        <div key={key}>
          <div
            onClick={() => setExpanded(p => ({ ...p, [key]: !p[key] }))}
            style={{
              paddingLeft: depth * 14 + 8, paddingTop: 5, paddingBottom: 5,
              cursor: "pointer", borderRadius: 5, display: "flex", alignItems: "center", gap: 6,
              color: MUTED, fontSize: 12.5, transition: "all .15s"
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.04)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderOpen size={12} style={{ color: "#fbbf24" }} />
            <span>{name}</span>
          </div>
          {isOpen && <div>{renderTree(val.__children, depth + 1)}</div>}
        </div>
      );
    });
  };

  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: 20, display: "flex", flexDirection: "column", gap: 14
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Github size={16} color="#60a5fa" />
        <span style={{ color: TEXT, fontWeight: 700, fontSize: 14 }}>GitHub Repository</span>
      </div>

      {/* Repo URL */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          data-testid="github-url-input"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchTree()}
          placeholder="https://github.com/owner/repo"
          style={{
            flex: 1, background: "#000", border: `1px solid ${BORDER}`,
            borderRadius: 7, padding: "8px 12px", color: TEXT, fontSize: 13,
            outline: "none", fontFamily: "JetBrains Mono, monospace"
          }}
        />
        <button
          data-testid="github-load-button"
          onClick={fetchTree}
          disabled={loading}
          style={{
            background: "#fff", color: "#09090b", border: "none",
            borderRadius: 7, padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6,
            opacity: loading ? .6 : 1, flexShrink: 0
          }}
        >
          {loading ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
          {loading ? "Loading…" : "Browse"}
        </button>
      </div>

      {/* PAT (private repos) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Lock size={12} color={MUTED} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, position: "relative" }}>
          <input
            data-testid="github-token-input"
            value={token}
            onChange={e => setToken(e.target.value)}
            type={showToken ? "text" : "password"}
            placeholder="GitHub Personal Access Token (for private repos)"
            style={{
              width: "100%", background: "#000", border: `1px solid ${BORDER}`,
              borderRadius: 7, padding: "7px 36px 7px 10px", color: TEXT, fontSize: 12,
              outline: "none", boxSizing: "border-box", fontFamily: "JetBrains Mono, monospace"
            }}
          />
          <button
            onClick={() => setShowToken(v => !v)}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: MUTED, cursor: "pointer", padding: 0
            }}
          >
            {showToken ? <X size={12} /> : <Lock size={12} />}
          </button>
        </div>
      </div>
      <p style={{ color: MUTED, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
        Token needs <code style={{ color: "#60a5fa" }}>repo</code> scope.{" "}
        <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer"
          style={{ color: "#60a5fa", textDecoration: "none" }}>Create one →</a>
      </p>

      {/* File Tree */}
      {treeData && (
        <div style={{
          background: "#000", border: `1px solid ${BORDER}`, borderRadius: 8,
          maxHeight: 280, overflowY: "auto", padding: "8px 4px"
        }}>
          <div style={{ padding: "4px 8px 8px", color: MUTED, fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase" }}>
            {treeData.owner}/{treeData.repo} · {treeData.branch}
          </div>
          {renderTree(buildTree(treeData.files))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [code, setCode]             = useState(() => sessionStorage.getItem("code") || "");
  const [language, setLanguage]     = useState(() => sessionStorage.getItem("language") || "JavaScript");
  const [review, setReview]         = useState(() => {
    const s = sessionStorage.getItem("review");
    return s ? JSON.parse(s) : null;
  });
  const [rawReview, setRawReview]   = useState(() => sessionStorage.getItem("rawReview") || "");
  const [loading, setLoading]       = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);

  // GitHub state
  const [githubMode, setGithubMode] = useState(false);
  const [githubCtx, setGithubCtx]   = useState(null); // { owner, repo, path, branch, token, sha, language }
  const [fixLoading, setFixLoading] = useState(false);
  const [commitUrl, setCommitUrl]   = useState(null);
  const [fixedCode, setFixedCode]   = useState(null);

  useEffect(() => { sessionStorage.setItem("code", code); }, [code]);
  useEffect(() => { sessionStorage.setItem("language", language); }, [language]);
  useEffect(() => {
    if (review) sessionStorage.setItem("review", JSON.stringify(review));
    if (rawReview) sessionStorage.setItem("rawReview", rawReview);
  }, [review, rawReview]);

  const handleGithubFileLoaded = (ctx) => {
    if (!ctx) return;
    setGithubCtx(ctx);
    if (ctx.code) {
      setCode(ctx.code);
      const langMap = {
        "python": "Python", "javascript": "JavaScript", "jsx": "JavaScript",
        "typescript": "TypeScript", "tsx": "TypeScript", "java": "Java",
        "go": "Go", "ruby": "Ruby", "php": "PHP", "rust": "Rust",
        "cpp": "C++", "c": "C", "csharp": "C#",
      };
      setLanguage(langMap[ctx.language] || "JavaScript");
      toast.success(`Loaded: ${ctx.path}`);
    }
  };

  const analyzeCode = async () => {
    if (!code.trim()) { toast.error("Please enter some code first."); return; }
    setLoading(true);
    setReview(null);
    setRawReview("");
    setFixedCode(null);
    setCommitUrl(null);
    try {
      const res = await fetch(`${API}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setRawReview(data.response);
      setReview(parseReview(data.response));
      toast.success("Review complete!");
    } catch (e) {
      toast.error(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // "Fix the Code" — commit to GitHub
  const fixCode = async () => {
    if (!review?.improvedCode?.code) { toast.error("Run a review first."); return; }
    if (!githubCtx?.token) { toast.error("GitHub token required to commit fixes."); return; }

    setFixLoading(true);
    try {
      const res = await fetch(`${API}/github/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: githubCtx.owner,
          repo: githubCtx.repo,
          path: githubCtx.path,
          token: githubCtx.token,
          fixedCode: review.improvedCode.code,
          sha: githubCtx.sha,
          branch: githubCtx.branch || "main"
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      setCommitUrl(data.commitUrl);
      setFixedCode(review.improvedCode.code);
      toast.success("✅ Fixed code committed to GitHub!");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setFixLoading(false);
    }
  };

  const isGithubFile = !!githubCtx?.sha;

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "IBM Plex Sans, sans-serif" }}>
      <Toaster richColors position="top-right" />

      {/* Background texture */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `url(https://static.prod-images.emergentagent.com/jobs/790d575e-fb42-42ce-9bb1-d5a7231f56d1/images/c3181385e2d6c1dbe56a484ccd66b13311edaebdabae227d9975583979701c22.png)`,
        backgroundSize: "cover", opacity: .06, mixBlendMode: "screen"
      }} />
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "linear-gradient(to bottom, transparent 60%, #09090b 100%)"
      }} />

      {/* ── Header ── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(9,9,11,.85)", backdropFilter: "blur(20px)",
        borderBottom: `1px solid ${BORDER}`, padding: "0 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 60
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Wand2 size={16} color="#fff" />
          </div>
          <span style={{ fontFamily: "Chivo, sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: "-.02em" }}>
            Code Review Co-Pilot
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            data-testid="github-mode-toggle"
            onClick={() => setGithubMode(v => !v)}
            style={{
              background: githubMode ? "rgba(59,130,246,.15)" : "transparent",
              border: `1px solid ${githubMode ? "rgba(59,130,246,.4)" : BORDER}`,
              color: githubMode ? "#60a5fa" : MUTED,
              borderRadius: 7, padding: "6px 14px", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
              transition: "all .2s"
            }}
          >
            <Github size={13} /> GitHub Mode
          </button>
          <button
            data-testid="load-sample-button"
            onClick={() => { setCode(SAMPLE_CODE); setLanguage("JavaScript"); toast.success("Sample code loaded!"); }}
            style={{
              background: "transparent", border: `1px solid ${BORDER}`,
              color: MUTED, borderRadius: 7, padding: "6px 14px",
              cursor: "pointer", fontSize: 12.5, fontWeight: 600, transition: "all .2s"
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#27272a"; e.currentTarget.style.color = TEXT; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = MUTED; }}
          >
            Load Sample
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "36px 24px" }}>

        {/* GitHub Panel */}
        {githubMode && (
          <div style={{ marginBottom: 28 }}>
            <GitHubPanel onCodeLoaded={handleGithubFileLoaded} />
          </div>
        )}

        {/* Input area */}
        <div style={{
          background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
          overflow: "hidden", marginBottom: 20,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)"
        }}>
          {/* Toolbar */}
          <div style={{
            padding: "10px 16px", borderBottom: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "space-between"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {githubCtx?.path && (
                <span style={{
                  background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.25)",
                  color: "#60a5fa", borderRadius: 5, padding: "2px 9px", fontSize: 11.5,
                  fontFamily: "JetBrains Mono, monospace", display: "flex", alignItems: "center", gap: 5
                }}>
                  <Github size={10} /> {githubCtx.path}
                </span>
              )}
              <select
                data-testid="language-select"
                value={language}
                onChange={e => setLanguage(e.target.value)}
                style={{
                  background: "#000", border: `1px solid ${BORDER}`, color: TEXT,
                  borderRadius: 6, padding: "4px 10px", fontSize: 12.5, cursor: "pointer", outline: "none"
                }}
              >
                {["JavaScript","TypeScript","Python","Java","Go","Ruby","PHP","Rust","C++","C","C#","Swift","Kotlin","HTML","CSS","SQL","Bash"].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setCode("")} style={{
                background: "transparent", border: `1px solid ${BORDER}`, color: MUTED,
                borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 12
              }}>Clear</button>
            </div>
          </div>

          {/* Textarea */}
          <textarea
            data-testid="code-input"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder={`Paste your ${language} code here…`}
            style={{
              width: "100%", minHeight: 300, background: "#000", color: TEXT,
              border: "none", outline: "none", resize: "vertical",
              padding: "20px 24px", fontSize: 13.5, lineHeight: 1.75,
              fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
              caretColor: "#60a5fa"
            }}
          />
        </div>

        {/* Analyze button */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 44 }}>
          <button
            data-testid="analyze-button"
            onClick={analyzeCode}
            disabled={loading}
            style={{
              background: loading ? "#27272a" : "#fff", color: loading ? MUTED : "#09090b",
              border: "none", borderRadius: 9, padding: "13px 40px",
              fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 10,
              boxShadow: loading ? "none" : "0 0 0 1px rgba(255,255,255,.1), 0 4px 24px rgba(0,0,0,.4)",
              transition: "all .2s"
            }}
          >
            {loading
              ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Reviewing like a senior engineer…</>
              : <><Play size={17} /> Analyze Code</>
            }
          </button>
        </div>

        {/* Results */}
        {review && (
          <>
            {/* Bento grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 18, marginBottom: 24
            }}>
              <ReviewCard section="issues"       data={review.issues} />
              <ReviewCard section="security"     data={review.security} />
              <ReviewCard section="smells"       data={review.smells} />
              <ReviewCard section="improvements" data={review.improvements} />
            </div>

            {/* Improved Code — full width */}
            <div style={{
              background: SURFACE, border: `1px solid ${BORDER}`,
              borderTop: "2px solid #3b82f6",
              borderRadius: 10, overflow: "hidden", marginBottom: 18
            }}>
              <div style={{
                padding: "14px 20px", borderBottom: `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                  ✨ Improved Code
                  {isGithubFile && (
                    <span style={{
                      background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.25)",
                      color: "#60a5fa", fontSize: 11, borderRadius: 4, padding: "1px 7px", marginLeft: 4
                    }}>
                      {githubCtx.path}
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <CopyButton text={review.improvedCode.code} testId="copy-code-button" />

                  {/* ── Fix the Code button ── */}
                  {isGithubFile && (
                    <button
                      data-testid="fix-code-button"
                      onClick={fixCode}
                      disabled={fixLoading}
                      style={{
                        background: fixLoading ? "#27272a" : "linear-gradient(135deg,#22c55e,#16a34a)",
                        color: "#fff", border: "none", borderRadius: 7,
                        padding: "6px 16px", fontWeight: 700, fontSize: 12.5,
                        cursor: fixLoading ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 7,
                        opacity: fixLoading ? .7 : 1, transition: "all .2s",
                        boxShadow: fixLoading ? "none" : "0 2px 12px rgba(34,197,94,.3)"
                      }}
                      onMouseEnter={e => { if (!fixLoading) e.currentTarget.style.filter = "brightness(1.1)"; }}
                      onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
                    >
                      {fixLoading
                        ? <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Committing…</>
                        : <><GitCommit size={13} /> Fix the Code in GitHub</>
                      }
                    </button>
                  )}
                </div>
              </div>

              {/* Commit success banner */}
              {commitUrl && (
                <div style={{
                  background: "rgba(34,197,94,.1)", borderBottom: "1px solid rgba(34,197,94,.25)",
                  padding: "10px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 13
                }}>
                  <Check size={14} color="#22c55e" />
                  <span style={{ color: "#4ade80" }}>Fix committed successfully!</span>
                  <a href={commitUrl} target="_blank" rel="noreferrer"
                    style={{ color: "#60a5fa", textDecoration: "none", marginLeft: 6, fontSize: 12 }}>
                    View commit →
                  </a>
                </div>
              )}

              <SyntaxHighlighter
                language={inferLang(githubCtx?.path || `.${language.toLowerCase()}`)}
                style={vscDarkPlus}
                customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: "#0a0a0a", padding: "20px 24px" }}
                showLineNumbers
                wrapLongLines
              >
                {review.improvedCode.code || "// No improved code available"}
              </SyntaxHighlighter>
            </div>

            {/* Beginner Explanation accordion */}
            <div style={{
              background: "rgba(20,184,166,.06)", border: "1px solid rgba(20,184,166,.2)",
              borderTop: "2px solid #14b8a6", borderRadius: 10, overflow: "hidden"
            }}>
              <button
                data-testid="explanation-accordion"
                onClick={() => setExplanationOpen(v => !v)}
                style={{
                  width: "100%", padding: "14px 20px", background: "none", border: "none",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                  color: "#2dd4bf", fontWeight: 700, fontSize: 14
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  🧠 Beginner Explanation
                </span>
                {explanationOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {explanationOpen && (
                <div style={{ padding: "0 20px 18px", color: TEXT, fontSize: 13.5, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                  {review.explanation.text || "—"}
                </div>
              )}
            </div>
          </>
        )}

        {/* Skeleton loader */}
        {loading && !review && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{
                height: 140, borderRadius: 10, background: SURFACE, border: `1px solid ${BORDER}`,
                animation: "pulse 1.4s ease-in-out infinite"
              }} />
            ))}
          </div>
        )}
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Chivo:wght@400;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50% { opacity: .4; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #52525b; }
      `}</style>
    </div>
  );
}
