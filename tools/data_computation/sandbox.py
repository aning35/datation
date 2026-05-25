"""
Data Computation Skill - Isolated UV Workspace Sandbox

Each code execution runs within an isolated workspace managed by uv,
with support for automatically installing missing Python packages.
"""

import json
import os
import re
import subprocess
import time
from contextvars import ContextVar
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

# Inject the current thread_id into the sandbox via ContextVar to avoid global state conflicts
# Set by calling sandbox_thread_id.set(thread_id) in main.py's event_generator
sandbox_thread_id: ContextVar[str] = ContextVar("sandbox_thread_id", default="unknown")
sandbox_history_thread_ids: ContextVar[list[str]] = ContextVar("sandbox_history_thread_ids", default=[])
sandbox_current_task: ContextVar[str] = ContextVar("sandbox_current_task", default="")

import shutil
import glob


# Common analysis packages pre-installed in each workspace
DEFAULT_PACKAGES = [
    "pandas",
    "matplotlib",
    "numpy",
    "psycopg2-binary",
    "seaborn",
    "scikit-learn",
    "scipy"
]

# Maximum retries for automatic package installation
MAX_AUTO_INSTALL_RETRIES = 3

# matplotlib Chinese font configuration preamble code, injected before each execution of user scripts
MATPLOTLIB_FONT_PREAMBLE = '''
# === Auto-injected: matplotlib Chinese font configuration ===
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontManager

def _setup_chinese_font():
    """Automatically detect and configure Chinese fonts, and monkey-patch plt to prevent fonts from being reset during each figure creation."""
    candidates = [
        'PingFang SC',
        'Heiti SC',
        'STHeiti',
        'Microsoft YaHei',
        'SimHei',
        'WenQuanYi Micro Hei',
        'Noto Sans CJK SC',
        'DejaVu Sans',
    ]
    fm = FontManager()
    available = {f.name for f in fm.ttflist}

    chosen_font = 'DejaVu Sans'
    for font in candidates:
        if font in available:
            chosen_font = font
            break

    def _apply_font():
        matplotlib.rcParams['font.sans-serif'] = [chosen_font, 'DejaVu Sans']
        matplotlib.rcParams['axes.unicode_minus'] = False

    # Apply once during initialization
    _apply_font()

    # monkey-patch plt.figure and plt.subplots to ensure the font is reapplied before creating each new chart
    _orig_figure = plt.figure
    _orig_subplots = plt.subplots

    def _patched_figure(*args, **kwargs):
        _apply_font()
        return _orig_figure(*args, **kwargs)

    def _patched_subplots(*args, **kwargs):
        _apply_font()
        return _orig_subplots(*args, **kwargs)

    plt.figure = _patched_figure
    plt.subplots = _patched_subplots

    # Handle font reset issues in seaborn
    try:
        import seaborn as sns
        sns.set_theme(font=chosen_font)
        _original_set_theme = sns.set_theme
        def override_set_theme(*args, **kwargs):
            if 'font' not in kwargs:
                kwargs['font'] = chosen_font
            result = _original_set_theme(*args, **kwargs)
            _apply_font()
            return result
        sns.set_theme = override_set_theme
        if hasattr(sns, 'set'):
            sns.set = override_set_theme
    except ImportError:
        pass

    # Automatically filter emojis from matplotlib text (STHeiti and other Chinese fonts do not support emojis)
    import re as _re
    _emoji_pattern = _re.compile(
        "["
        "\U0001F300-\U0001F9FF"  # Miscellaneous Symbols and Pictographs, Emoticons, etc.
        "\U0000FE00-\U0000FE0F"  # Variation Selectors
        "\U0000200D"             # Zero Width Joiner
        "\U00002702-\U000027B0"  # Dingbats
        "]+", flags=_re.UNICODE
    )
    def _strip_emoji(text):
        if isinstance(text, str):
            return _emoji_pattern.sub('', text).strip()
        return text

    for _fn_name in ('title', 'xlabel', 'ylabel', 'suptitle'):
        _orig = getattr(plt, _fn_name)
        def _make_wrapper(orig_fn):
            def _wrapper(*args, **kwargs):
                if args:
                    args = (_strip_emoji(args[0]),) + args[1:]
                if 'label' in kwargs:
                    kwargs['label'] = _strip_emoji(kwargs['label'])
                return orig_fn(*args, **kwargs)
            return _wrapper
        setattr(plt, _fn_name, _make_wrapper(_orig))

_setup_chinese_font()
del _setup_chinese_font
# === End auto-injected ===
'''


class PythonCodeInput(BaseModel):
    query: str = Field(description="The Python code snippet to execute")


class UVSandbox:
    """
    Isolated subprocess Python sandbox based on uv.
    Each analysis task has an independent working directory and virtual environment.
    """

    def __init__(self, workspace_base: str = "~/.datation/workspaces"):
        import uuid
        self.workspace_base = os.path.abspath(os.path.expanduser(workspace_base))
        self._fallback_thread_id = uuid.uuid4().hex

    def _ensure_workspace(self) -> str:
        """Ensure that the workspace for the current task has been created and initialized."""

        # Extract thread_id and determine the working directory
        thread_id = sandbox_thread_id.get(self._fallback_thread_id)
        
        # The target path is determined before analysis starts; the sandbox constructs the default path using thread_id
        workspace = os.path.join(self.workspace_base, f"thread_{thread_id}")
        os.makedirs(workspace, exist_ok=True)

        # Create the outputs subdirectory
        os.makedirs(os.path.join(workspace, "outputs"), exist_ok=True)

        # Initialize an independent project using uv init if not already initialized
        if not os.path.exists(os.path.join(workspace, "pyproject.toml")):
            subprocess.run(
                ["uv", "init", "--no-readme"],
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=60,
            )

            # Pre-install common analysis packages
            if DEFAULT_PACKAGES:
                subprocess.run(
                    ["uv", "add"] + DEFAULT_PACKAGES,
                    cwd=workspace,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )

        print(f"[Sandbox] Workspace ready: {workspace}")
        return workspace

    def reset(self):
        """Reset the workspace; no special action needed for stateless sandbox."""
        pass

    def _get_next_run_run_index(self, workspace: str) -> int:
        """Get the next available sequence number based on existing script_{index}.py in the workspace directory.
        If the last run failed, reuse the last sequence number."""
        scripts = glob.glob(os.path.join(workspace, "script_*.py"))
        indices = []
        for s in scripts:
            match = re.search(r"script_(\d+)\.py", os.path.basename(s))
            if match:
                indices.append(int(match.group(1)))
        
        if not indices:
            return 1
            
        max_index = max(indices)
        
        # Check the status of the last run
        status_file = os.path.join(workspace, "outputs", f"run_{max_index}", "status.txt")
        if os.path.exists(status_file):
            with open(status_file, "r") as f:
                if f.read().strip() == "FAILED":
                    return max_index
        
        return max_index + 1

    def _extract_missing_module(self, stderr: str) -> str | None:
        """Extract the missing module name from stderr."""
        match = re.search(r"ModuleNotFoundError: No module named ['\"](\w+)['\"]", stderr)
        if match:
            module_name = match.group(1)
            # Handle cases where common module names differ from package names
            mapping = {
                "sklearn": "scikit-learn",
                "yaml": "PyYAML",
                "cv2": "opencv-python",
                "bs4": "beautifulsoup4",
                "PIL": "pillow",
                "sns": "seaborn"
            }
            return mapping.get(module_name, module_name)
        return None

    def _install_package(self, workspace: str, package_name: str) -> bool:
        """Install missing package in the workspace."""
        print(f"[Sandbox] Auto-installing package: {package_name}")
        result = subprocess.run(
            ["uv", "add", package_name],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return result.returncode == 0

    def _get_outputs_state(self, outputs_dir: str) -> dict:
        """Retrieve all files and their modification times in the outputs directory."""
        state = {}
        if not os.path.exists(outputs_dir):
            return state
        for root, dirs, files in os.walk(outputs_dir):
            # Filter out directories starting with run_ (historical records)
            dirs[:] = [d for d in dirs if not d.startswith("run_")]
            for f in files:
                path = os.path.join(root, f)
                rel_path = os.path.relpath(path, outputs_dir)
                try:
                    state[rel_path] = os.path.getmtime(path)
                except OSError:
                    pass
        return state

    def _organize_outputs(self, workspace: str, run_index: int, stdout: str, stderr: str, before_state: dict):
        """Copy newly created or modified files in the outputs root directory to the run_{run_index} subdirectory, and record logs."""
        outputs_dir = os.path.join(workspace, "outputs")
        run_outputs_dir = os.path.join(outputs_dir, f"run_{run_index}")
        os.makedirs(run_outputs_dir, exist_ok=True)

        after_state = self._get_outputs_state(outputs_dir)
        
        # Identify newly created or modified files and copy them
        for rel_path, mtime in after_state.items():
            # Compare mtime; if there are slight changes or new files, copy them
            if rel_path not in before_state or mtime > before_state[rel_path]:
                src = os.path.join(outputs_dir, rel_path)
                dst = os.path.join(run_outputs_dir, rel_path)
                
                try:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                except Exception as e:
                    print(f"[Sandbox] Failed to copy {rel_path} to {run_outputs_dir}: {e}")

        # Write execution log
        with open(os.path.join(run_outputs_dir, "execution.log"), "w", encoding="utf-8") as f:
            f.write(f"--- STDOUT ---\n{stdout}\n\n--- STDERR ---\n{stderr}\n")

        # Write running status (determined when called by the run method)
    
    def _write_run_status(self, workspace: str, run_index: int, status: str):
        """Record the running status: SUCCESS or FAILED."""
        status_file = os.path.join(workspace, "outputs", f"run_{run_index}", "status.txt")
        with open(status_file, "w") as f:
            f.write(status)

    def _append_manifest(self, workspace: str, run_index: int, status: str):
        """Append an execution record to outputs/manifest.md for shared perception among all agents."""
        from datetime import datetime
        manifest_path = os.path.join(workspace, "outputs", "manifest.md")
        run_dir = os.path.join(workspace, "outputs", f"run_{run_index}")

        # Collect files generated in this run
        generated_files = []
        if os.path.exists(run_dir):
            for f in sorted(os.listdir(run_dir)):
                if f in ("status.txt", "execution.log"):
                    continue
                fpath = os.path.join(run_dir, f)
                if os.path.isfile(fpath):
                    size_kb = os.path.getsize(fpath) / 1024
                    generated_files.append(f"  - `run_{run_index}/{f}` ({size_kb:.1f} KB)")

        # Task functional description (from the Planner's step description)
        task_desc = sandbox_current_task.get("").strip()
        if len(task_desc) > 150:
            task_desc = task_desc[:150] + "..."

        status_emoji = "✅" if status == "SUCCESS" else "❌"
        timestamp = datetime.now().strftime("%H:%M:%S")

        entry = f"\n### run_{run_index} [{status_emoji} {status}] — {timestamp}\n"
        entry += f"- **Script**: `script_{run_index}.py`\n"
        if task_desc:
            entry += f"- **Task**: {task_desc}\n"
        if generated_files:
            entry += f"- **Output Files**:\n" + "\n".join(generated_files) + "\n"
        else:
            entry += f"- **Output Files**: (No new files)\n"

        try:
            # Add file header when writing for the first time
            is_new = not os.path.exists(manifest_path)
            with open(manifest_path, "a", encoding="utf-8") as f:
                if is_new:
                    f.write("# Workspace Manifest\n")
                    f.write("This file automatically records the output of each code execution for shared reference among all agents.\n")
                f.write(entry)
            print(f"[Manifest] Appended run_{run_index} ({status}) to manifest.md")
        except Exception as e:
            print(f"[Manifest] Failed to write manifest: {e}")

    def _get_history_paths_info(self) -> str:
        """Generate path information for historical working directories and inject it into the code execution environment."""
        history_ids = sandbox_history_thread_ids.get()
        if not history_ids:
            return ""

        print(f"[Sandbox] Injecting {len(history_ids)} history workspace paths")
        paths_info = "\n# === Historical Workspace Paths (Access data from previous analyses) ===\n"
        paths_info += "# The following are selected historical conversation working directories. You can read data files from them:\n"
        for hist_id in history_ids:
            hist_path = os.path.join(self.workspace_base, f"thread_{hist_id}", "outputs")
            if os.path.exists(hist_path):
                paths_info += f"# - {hist_path}\n"
                print(f"[Sandbox] History path exists: {hist_path}")
            else:
                print(f"[Sandbox] History path NOT found: {hist_path}")
        paths_info += "# === End ===\n\n"
        return paths_info

    def run(self, code: str) -> str:
        """
        Execute Python code in an isolated workspace.
        If a ModuleNotFoundError is encountered, automatically install and retry.
        """
        workspace = self._ensure_workspace()
        run_index = self._get_next_run_run_index(workspace)

        # Retrieve the outputs state before execution
        outputs_dir = os.path.join(workspace, "outputs")
        before_state = self._get_outputs_state(outputs_dir)

        # Write the code to the script file (injecting matplotlib Chinese font config and history path info)
        script_filename = f"script_{run_index}.py"
        script_path = os.path.join(workspace, script_filename)
        history_paths = self._get_history_paths_info()

        # Security measure: automatically replace other thread paths appearing in the code with the current workspace path.
        # Prevents the LLM from copying paths of old sessions from contexts like final_report.md, causing cross-workspace writes.
        current_thread_id = sandbox_thread_id.get(self._fallback_thread_id)
        
        # Cross-platform path separator compatibility: split the base path by slash/backslash, escape each segment individually, and then join with [/\\]
        parts = re.split(r'[/\\]', self.workspace_base)
        escaped_base = r'[/\\]'.join(re.escape(p) for p in parts)
        
        thread_path_pattern = re.compile(
            escaped_base + r'[/\\]thread_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        )
        current_workspace_path = os.path.join(self.workspace_base, f"thread_{current_thread_id}")
        
        # Use a lambda function as the replacement parameter to prevent backslashes in Windows paths (like \w) from being incorrectly parsed as regular expression escapes by re.sub
        rewritten_code = thread_path_pattern.sub(lambda m: current_workspace_path, code)
        if rewritten_code != code:
            print(f"[Sandbox] ⚠️ Rewrote cross-workspace paths in code to current workspace: {current_workspace_path}")
            code = rewritten_code

        with open(script_path, "w", encoding="utf-8") as f:
            f.write(MATPLOTLIB_FONT_PREAMBLE + "\n" + history_paths + code)

        retries = 0
        while retries <= MAX_AUTO_INSTALL_RETRIES:
            try:
                # [FIX] Isolate the VIRTUAL_ENV of the parent process to avoid environment mismatch warnings from uv
                env = os.environ.copy()
                env.pop("VIRTUAL_ENV", None)

                result = subprocess.run(
                    ["uv", "run", "python", script_filename],
                    cwd=workspace,
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=300,  # 5 minutes timeout
                )

                stdout = result.stdout.strip()
                stderr = result.stderr.strip()

                # Organize outputs generated in this run regardless of success or failure
                self._organize_outputs(workspace, run_index, stdout, stderr, before_state)

                if result.returncode == 0:
                    # Execution success
                    self._write_run_status(workspace, run_index, "SUCCESS")
                    self._append_manifest(workspace, run_index, "SUCCESS")
                    output = stdout if stdout else "(Code execution completed, no stdout)"
                    output += f"\n\n[System Notification]: Your files saved to 'outputs/' have been automatically organized into the directory 'run_{run_index}'. When referencing generated charts or files in your final response or report, YOU MUST USE THE PATH format 'run_{run_index}/filename.ext'."
                    if stderr:
                        # Has warnings, display them as well
                        output += f"\n\n[stderr warnings]:\n{stderr[:500]}"
                    return output

                # Execution failure
                self._write_run_status(workspace, run_index, "FAILED")
                self._append_manifest(workspace, run_index, "FAILED")
                
                # Check if it is a missing package error
                missing = self._extract_missing_module(stderr)
                if missing and retries < MAX_AUTO_INSTALL_RETRIES:
                    installed = self._install_package(workspace, missing)
                    if installed:
                        retries += 1
                        print(f"[Sandbox] Retry {retries}/{MAX_AUTO_INSTALL_RETRIES} after installing '{missing}'")
                        continue
                    else:
                        return (
                            f"【EXECUTION ERROR】: Failed to install package '{missing}'.\n"
                            f"Stderr:\n{stderr}\n\n"
                            f"-> Action Required: The environment cannot install this package. "
                            f"Please rewrite your code to use standard libraries or pre-installed packages, and execute again!"
                        )
                else:
                    # Non-missing package error or reached maximum retries
                    err_msg = f"{stderr}" if stderr else f"Process exited with code {result.returncode}"
                    return (
                        f"【EXECUTION ERROR】:\n{err_msg}\n\n"
                        f"-> Action Required: Your Python code encountered an error during execution. "
                        f"Please carefully read the traceback above, locate the bug, rewrite the corrected code, and execute again!"
                    )

            except subprocess.TimeoutExpired:
                return (
                    "【EXECUTION TIMEOUT】: Code execution timed out (maximum 5 minutes).\n"
                    "-> Action Required: Your code took too long to run or entered an infinite loop. "
                    "Please optimize your code, reduce data logic complexity, and execute again!"
                )
            except Exception as e:
                return (
                    f"【SANDBOX SYSTEM ERROR】: {type(e).__name__}: {str(e)}\n"
                    f"-> Action Required: A system error occurred. Please try an alternative approach."
                )

        return "【EXECUTION ERROR】: Maximum auto-install retries reached. Please do not use this missing dependency package; rewrite the code using alternative methods and execute again!"


def create_data_computation_tool(workspace_base: str = "~/.datation/workspaces") -> StructuredTool:
    """
    Create a Python computation sandbox tool based on uv-isolated workspaces.

    Features:
    - Independent uv virtual environment for each task
    - Missing packages automatically installed and retried
    - Subprocess isolation, without affecting the main service process
    """
    sandbox = UVSandbox(workspace_base=workspace_base)

    def _run_sync(query: str) -> str:
        return sandbox.run(query)

    async def _run_async(query: str) -> str:
        # Since subprocess is blocking, run in a thread pool
        import asyncio
        return await asyncio.to_thread(sandbox.run, query)

    return StructuredTool(
        name="DataComputationSandbox",
        description=(
            "An isolated Python execution sandbox powered by uv. "
            "Send Python code to execute data analysis, run pandas/numpy operations, "
            "generate matplotlib charts, or perform any computation. "
            "Missing packages are automatically installed. "
            "IMPORTANT: Output files (charts, CSVs) MUST be saved DIRECTLY to the 'outputs/' root directory (e.g. 'outputs/my_chart.png'). "
            "DO NOT create or save files into subdirectories like 'outputs/run_001/' or 'outputs/run_X/'. The system will automatically organize your files into the correct run directory! "
            "When generating charts, do NOT manually set fonts (the system auto-injects Chinese fonts properly). "
            "Do NOT call seaborn's set() or set_theme() without passing 'font' explicitly, or you will cause mojibake (garbled Chinese text)."
        ),
        func=_run_sync,
        coroutine=_run_async,
        args_schema=PythonCodeInput,
    )


def read_workspace_manifest(workspace_base: str = "~/.datation/workspaces") -> str:
    """Read the workspace manifest file (manifest.md) of the current session to inject it into the agent's context."""
    workspace_base = os.path.abspath(os.path.expanduser(workspace_base))
    thread_id = sandbox_thread_id.get("unknown")
    manifest_path = os.path.join(workspace_base, f"thread_{thread_id}", "outputs", "manifest.md")

    if not os.path.exists(manifest_path):
        return ""

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""
