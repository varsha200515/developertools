from flask import Flask, request, jsonify
from flask_cors import CORS
from emergentintegrations.llm.chat import LlmChat
import os
import requests
import base64

app = Flask(__name__)
CORS(app)

api_key = os.getenv("ANTHROPIC_API_KEY")

# ─────────────────────────────────────────────
# Existing: review raw code
# ─────────────────────────────────────────────
@app.route("/review", methods=["POST"])
def review_code():
    data = request.json
    code = data.get("code", "")
    language = data.get("language", "")

    if not code:
        return jsonify({"error": "No code provided"}), 422

    chat = LlmChat(
        api_key=api_key,
        session_id="code-review-session",
        system_message="""Act as a senior software engineer performing a professional code review.
Analyze the given code and respond in the following structured format:
1. 🚨 Issues:
2. 🔐 Security Risks:
3. 🧹 Code Smells:
4. ⚡ Improvements:
5. ✨ Improved Code:
- Show ONLY corrected lines using comments like // FIX:
6. 🧠 Beginner Explanation:
Keep it concise and structured."""
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    prompt = f"Language: {language}\n\n{code}" if language else code
    response = chat.send_message(prompt)
    return jsonify({"response": response})


# ─────────────────────────────────────────────
# NEW: fetch file tree from a GitHub repo
# ─────────────────────────────────────────────
@app.route("/github/tree", methods=["POST"])
def github_tree():
    """
    Body: { repoUrl: string, token: string (optional) }
    Returns the recursive file tree of the default branch.
    """
    data = request.json
    repo_url = data.get("repoUrl", "").strip().rstrip("/")
    token = data.get("token", "").strip()

    owner, repo = _parse_repo_url(repo_url)
    if not owner:
        return jsonify({"error": "Invalid GitHub repo URL"}), 400

    headers = _gh_headers(token)

    # Get default branch
    repo_info = requests.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers)
    if repo_info.status_code == 404:
        return jsonify({"error": "Repository not found. Check URL or token permissions."}), 404
    if repo_info.status_code == 401:
        return jsonify({"error": "Authentication failed. Provide a valid PAT for private repos."}), 401
    if not repo_info.ok:
        return jsonify({"error": f"GitHub API error: {repo_info.json().get('message', 'Unknown error')}"}), repo_info.status_code

    default_branch = repo_info.json().get("default_branch", "main")

    # Get recursive tree
    tree_resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}?recursive=1",
        headers=headers
    )
    if not tree_resp.ok:
        return jsonify({"error": "Failed to fetch repository tree"}), tree_resp.status_code

    tree = tree_resp.json().get("tree", [])
    # Only return blob (file) entries; filter out binaries by extension
    CODE_EXTENSIONS = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".cs",
        ".go", ".rb", ".php", ".rs", ".swift", ".kt", ".scala", ".html",
        ".css", ".scss", ".json", ".yaml", ".yml", ".toml", ".sh", ".bash",
        ".md", ".txt", ".sql", ".r", ".dart", ".lua", ".vim", ".env.example"
    }
    files = [
        {"path": item["path"], "sha": item["sha"], "size": item.get("size", 0)}
        for item in tree
        if item["type"] == "blob"
        and any(item["path"].endswith(ext) for ext in CODE_EXTENSIONS)
        and item.get("size", 0) < 500_000  # skip files > 500 KB
    ]

    return jsonify({
        "owner": owner,
        "repo": repo,
        "branch": default_branch,
        "files": files
    })


# ─────────────────────────────────────────────
# NEW: fetch a single file's content
# ─────────────────────────────────────────────
@app.route("/github/file", methods=["POST"])
def github_file():
    """
    Body: { owner, repo, path, token }
    Returns decoded file content + sha (needed for commit).
    """
    data = request.json
    owner = data.get("owner")
    repo = data.get("repo")
    path = data.get("path")
    token = data.get("token", "")

    if not all([owner, repo, path]):
        return jsonify({"error": "owner, repo, and path are required"}), 422

    headers = _gh_headers(token)
    resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=headers
    )
    if not resp.ok:
        return jsonify({"error": f"Failed to fetch file: {resp.json().get('message')}"}), resp.status_code

    file_data = resp.json()
    content_b64 = file_data.get("content", "")
    content = base64.b64decode(content_b64).decode("utf-8", errors="replace")
    sha = file_data.get("sha")

    return jsonify({"content": content, "sha": sha, "path": path})


# ─────────────────────────────────────────────
# NEW: review + auto-fix a file from GitHub
# ─────────────────────────────────────────────
@app.route("/github/review", methods=["POST"])
def github_review():
    """
    Body: { owner, repo, path, token, language }
    Fetches the file, reviews it, returns review + fixed code.
    """
    data = request.json
    owner = data.get("owner")
    repo = data.get("repo")
    path = data.get("path")
    token = data.get("token", "")
    language = data.get("language", _infer_language(path or ""))

    # Fetch file
    headers = _gh_headers(token)
    resp = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=headers
    )
    if not resp.ok:
        return jsonify({"error": f"Failed to fetch file: {resp.json().get('message')}"}), resp.status_code

    file_data = resp.json()
    content = base64.b64decode(file_data.get("content", "")).decode("utf-8", errors="replace")
    sha = file_data.get("sha")

    # Review
    chat = LlmChat(
        api_key=api_key,
        session_id=f"github-review-{owner}-{repo}-{path}",
        system_message="""Act as a senior software engineer performing a professional code review.
Analyze the given code and respond in the following structured format:
1. 🚨 Issues:
2. 🔐 Security Risks:
3. 🧹 Code Smells:
4. ⚡ Improvements:
5. ✨ Improved Code:
- Provide the COMPLETE corrected file, ready to commit. No truncation.
6. 🧠 Beginner Explanation:
Keep it concise and structured."""
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    prompt = f"File: {path}\nLanguage: {language}\n\n{content}"
    review_response = chat.send_message(prompt)

    # Extract the improved code block from the response
    fixed_code = _extract_improved_code(review_response, content)

    return jsonify({
        "response": review_response,
        "originalCode": content,
        "fixedCode": fixed_code,
        "sha": sha,
        "path": path,
        "language": language
    })


# ─────────────────────────────────────────────
# NEW: commit fixed code back to GitHub
# ─────────────────────────────────────────────
@app.route("/github/commit", methods=["POST"])
def github_commit():
    """
    Body: { owner, repo, path, token, fixedCode, sha, branch (optional), commitMessage (optional) }
    Commits the fixed code to GitHub.
    """
    data = request.json
    owner = data.get("owner")
    repo = data.get("repo")
    path = data.get("path")
    token = data.get("token", "")
    fixed_code = data.get("fixedCode", "")
    sha = data.get("sha")
    branch = data.get("branch", "main")
    commit_message = data.get("commitMessage", f"fix: auto-fix applied by Code Review Co-Pilot 🤖")

    if not all([owner, repo, path, token, fixed_code, sha]):
        return jsonify({"error": "owner, repo, path, token, fixedCode, and sha are required"}), 422

    headers = _gh_headers(token)
    encoded = base64.b64encode(fixed_code.encode("utf-8")).decode("utf-8")

    payload = {
        "message": commit_message,
        "content": encoded,
        "sha": sha,
        "branch": branch
    }

    resp = requests.put(
        f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
        headers=headers,
        json=payload
    )

    if resp.ok:
        commit_data = resp.json()
        commit_url = commit_data.get("commit", {}).get("html_url", "")
        return jsonify({"success": True, "commitUrl": commit_url, "message": "Code fixed and committed successfully!"})
    else:
        error_msg = resp.json().get("message", "Unknown error")
        return jsonify({"error": f"Commit failed: {error_msg}"}), resp.status_code


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
def _parse_repo_url(url: str):
    """Extract owner and repo from GitHub URL."""
    try:
        url = url.replace("https://github.com/", "").replace("http://github.com/", "")
        url = url.rstrip("/")
        # Remove trailing .git
        if url.endswith(".git"):
            url = url[:-4]
        parts = url.split("/")
        if len(parts) >= 2:
            return parts[0], parts[1]
    except Exception:
        pass
    return None, None


def _gh_headers(token: str):
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _infer_language(path: str) -> str:
    ext_map = {
        ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript",
        ".ts": "TypeScript", ".tsx": "TypeScript", ".java": "Java",
        ".c": "C", ".cpp": "C++", ".cs": "C#", ".go": "Go",
        ".rb": "Ruby", ".php": "PHP", ".rs": "Rust", ".swift": "Swift",
        ".kt": "Kotlin", ".html": "HTML", ".css": "CSS", ".sql": "SQL",
        ".sh": "Bash", ".md": "Markdown",
    }
    for ext, lang in ext_map.items():
        if path.endswith(ext):
            return lang
    return "Unknown"


def _extract_improved_code(response: str, fallback: str) -> str:
    """
    Pull the code block from the ✨ Improved Code section.
    Falls back to original code if extraction fails.
    """
    import re
    # Try to find a fenced code block after the Improved Code header
    pattern = r"(?:✨\s*Improved Code.*?)```[\w]*\n([\s\S]+?)```"
    match = re.search(pattern, response, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # Try any fenced code block
    blocks = re.findall(r"```[\w]*\n([\s\S]+?)```", response)
    if blocks:
        # Return the longest block (most likely the full fixed file)
        return max(blocks, key=len).strip()
    return fallback


if __name__ == "__main__":
    app.run(debug=True)
